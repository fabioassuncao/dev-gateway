import { Hono } from 'hono'
import { z } from 'zod'
import type { AppDeps } from './deps.ts'
import { HTTPException } from 'hono/http-exception'
import { readProjectGit } from '../core/git.ts'
import { mergeLogSources, type LogSourceLines } from '../core/projectlogs.ts'
import { applyOverrides, loadOverrides } from '../core/overrides.ts'
import { issueForEnvironment, resolveLinks } from '../core/issue-environments.ts'
import type { Snapshot } from '../core/inventory.ts'
import {
  Project,
  ProjectActionResult,
  ProjectGit,
  ProjectLogsResponse,
  ProjectRebuildResult,
  ProjectRemovalPreview,
  ProjectRemoveResult,
  type ProjectGit as ProjectGitView,
  type ProjectLogSource,
} from '../../shared/types.ts'
import { runProjectAction } from '../core/actions.ts'
import { projectRemovalPreview, rebuildProject, removeProject } from '../core/operations.ts'
import { documentRoute, projectParameter, tailParameter } from '../openapi.ts'

export const ProjectsResponse = z.object({ projects: z.array(Project) }).strict().meta({ ref: 'ProjectsResponse' })

/** Per source, and overall: a ten-service project cannot ask for 20 000 lines. */
const MAX_TAIL = 2000
const DEFAULT_TAIL = 200
const AGGREGATE_DEFAULT_TAIL = 100

function clampTail(requested: string | undefined, fallback: number): number {
  const value = Number(requested ?? String(fallback))
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.trunc(value), 1), MAX_TAIL)
}

/**
 * One source for open pull requests, stated.
 *
 * The host `gh` scan and the App can both report them. When the App is
 * configured **and** this repository is one the installation granted, the App
 * wins, because it is the source that can also write. Otherwise the scan's
 * forge block stands exactly as it does today, so a panel with no App is
 * unchanged and `GitCard` needs no change either.
 */
async function withForgeFromApp(deps: AppDeps, git: ProjectGitView): Promise<ProjectGitView> {
  const slug = git.remote?.slug
  if (!slug || deps.github === null || !deps.github.status().configured) return git
  if (!deps.db?.status().available) return git

  const repository = await deps.db.github.findRepository(slug)
  if (!repository) return git

  const pulls = (await deps.db.github.listPullRequests(repository.id)).map((pull) => ({
    number: pull.number,
    title: pull.title,
    state: pull.state,
    draft: false,
    reviewDecision: null,
    checks: null,
    url: pull.htmlUrl,
    headRefName: null,
  }))

  return {
    ...git,
    forge: {
      kind: 'github-app',
      collectedAt: Math.floor(Date.now() / 1000),
      authenticated: true,
      reason: null,
      pulls,
    },
  }
}

/**
 * The issue this environment is running for, when the panel can tell.
 *
 * Every step degrades to `null`: no database, no projection, no match. Nothing
 * here is required for a project page to render.
 */
async function issueOf(deps: AppDeps, snapshot: Snapshot, project: Project) {
  if (!deps.db?.status().available) return null
  const issues = await deps.db.github.listIssues({})
  if (issues.length === 0) return null

  const branches = new Map<string, string | null>(
    snapshot.projects.map((item) => [item.name, readProjectGit(deps.config, item.name).git?.branch ?? null]),
  )
  const manual = (await deps.db.github.listIssueEnvironments()).map((row) => ({
    issueId: row.issueId,
    composeProject: row.composeProject,
    branch: row.branch,
  }))
  const links = resolveLinks(snapshot, issues, manual, branches)
  return issueForEnvironment(project, issues, links)
}

export function projectRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  // Projects are the integrated ones: a Compose project with at least one
  // service on the gateway. Everything else lives on the Docker page, where it
  // is clearly labelled as being outside the gateway.
  app.get('/projects', documentRoute({
    tag: 'Projects', operationId: 'listProjects', summary: 'List Compose projects', response: ProjectsResponse,
    parameters: [{
      name: 'all', in: 'query', required: false,
      description: 'Include Compose projects that have not adopted the gateway.',
      schema: { type: 'boolean', default: false },
    }],
    errors: [500, 502],
  }), async (c) => {
    const snapshot = await deps.cache.get()
    const all = c.req.query('all') === 'true'
    const projects = all ? snapshot.projects : snapshot.projects.filter((project) => project.integrated)
    // With no database, or none reachable, this is the identity function and
    // the response is byte-identical to a panel with no persistence at all.
    return c.json({ projects: applyOverrides(projects, await loadOverrides(deps.db)) })
  })

  app.get('/projects/:project', documentRoute({
    tag: 'Projects', operationId: 'getProject', summary: 'Get one running project', response: Project,
    parameters: [projectParameter], errors: [404, 500, 502],
  }), async (c) => {
    const snapshot = await deps.cache.get()
    const name = c.req.param('project')
    const project = snapshot.projects.find((item) => item.name === name)
    if (!project) throw new HTTPException(404, { message: `no project '${name}' is running` })
    const decorated = applyOverrides([project], await loadOverrides(deps.db))[0]!
    // Additive, and nullable: a panel with no App, no database or no link gets
    // exactly the object it got before.
    const issue = await issueOf(deps, snapshot, decorated)
    return c.json(issue === null ? decorated : { ...decorated, issue })
  })

  /**
   * What the host collected about this project's repository. Never live: the
   * panel reads a file and reports its age, and the response carries the
   * command that refreshes it. A project with no Git, no remote or no scan
   * gets a 200 with fewer fields, never an error.
   */
  app.get('/projects/:project/git', documentRoute({
    tag: 'Projects', operationId: 'getProjectGit', summary: 'Get collected Git metadata', response: ProjectGit,
    description: 'Reads a host-collected snapshot. No scan, repository or remote is represented as a smaller 200 response.',
    parameters: [projectParameter], errors: [404, 500],
  }), async (c) => {
    const snapshot = await deps.cache.get()
    const name = c.req.param('project')
    if (!snapshot.projects.some((item) => item.name === name)) {
      throw new HTTPException(404, { message: `no project '${name}' is running` })
    }
    return c.json(await withForgeFromApp(deps, readProjectGit(deps.config, name)))
  })

  /**
   * Every service of a project, interleaved.
   *
   * One unreadable container must not blank the four that answered, so sources
   * are read concurrently and a failure is reported *in* the response rather
   * than thrown. An unknown project is still a 404; a known project whose
   * sources all failed is a 200 carrying the reasons.
   */
  app.get('/projects/:project/logs', documentRoute({
    tag: 'Projects', operationId: 'getProjectLogs', summary: "Read every service's recent logs",
    response: ProjectLogsResponse,
    description: 'Reads each service concurrently. A source that could not be read is reported beside the sources that answered.',
    parameters: [
      projectParameter,
      tailParameter,
      {
        name: 'service', in: 'query', required: false,
        description: 'Restrict the read to one Compose service.',
        schema: { type: 'string' },
      },
    ],
    errors: [404, 500, 502],
  }), async (c) => {
    const snapshot = await deps.cache.get()
    const name = c.req.param('project')
    const project = snapshot.projects.find((item) => item.name === name)
    if (!project) throw new HTTPException(404, { message: `no project '${name}' is running` })

    const wanted = c.req.query('service')
    const services = project.services.filter(
      (service) => wanted === undefined || (service.service ?? service.name) === wanted,
    )
    const aggregating = services.length > 1
    const tail = clampTail(c.req.query('tail'), aggregating ? AGGREGATE_DEFAULT_TAIL : DEFAULT_TAIL)

    const reads = await Promise.allSettled(
      services.map((service) => deps.client.logs(service.id, { tail })),
    )

    const sources: ProjectLogSource[] = []
    const collected: LogSourceLines[] = []

    services.forEach((service, index) => {
      const label = service.service ?? service.name
      const result = reads[index]!
      const lines = result.status === 'fulfilled' ? result.value : []
      if (result.status === 'fulfilled') collected.push({ service: label, lines })
      sources.push({
        containerId: service.id,
        service: label,
        name: service.name,
        state: service.state,
        lineCount: lines.length,
        truncated: lines.length >= tail,
        error: result.status === 'rejected'
          ? `could not read logs: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`
          : null,
      })
    })

    const merged = mergeLogSources(collected, MAX_TAIL)
    return c.json({
      project: project.name,
      sources,
      lines: merged.lines,
      truncated: merged.truncated || sources.some((source) => source.truncated),
      ordered: merged.ordered,
    })
  })

  app.get('/projects/:project/removal-preview', documentRoute({
    tag: 'Projects', operationId: 'previewProjectRemoval',
    summary: 'Preview what removing this project from this host would touch',
    description: 'Advisory. Nothing is removed. Volume sizes are null: the panel has no volume inspect.',
    response: ProjectRemovalPreview,
    parameters: [projectParameter],
    errors: [403, 404, 500, 502],
  }), async (c) => {
    const snapshot = await deps.cache.get()
    return c.json(await projectRemovalPreview(snapshot, deps.config, deps.db, c.req.param('project')))
  })

  app.post('/projects/:project/operations/rebuild', documentRoute({
    tag: 'Projects', operationId: 'rebuildProject',
    summary: 'Rebuild this project through the runner',
    description: 'Writes a closed runner request and starts the prepared container. Volumes are preserved.',
    response: ProjectRebuildResult,
    parameters: [projectParameter],
    request: z.object({ noCache: z.boolean().optional() }).strict(),
    errors: [400, 403, 404, 409, 500, 502],
  }), async (c) => {
    const snapshot = await deps.cache.get()
    const body = await c.req.json().catch(() => ({})) as { noCache?: boolean }
    const result = await rebuildProject(deps.client, snapshot, deps.config, c.req.param('project'), {
      noCache: body.noCache === true,
    })
    deps.cache.invalidate()
    return c.json(result)
  })

  app.post('/projects/:project/operations/remove', documentRoute({
    tag: 'Projects', operationId: 'removeProject',
    summary: 'Remove this project from this host',
    description: 'Confirmation is the exact Compose project name, checked on the server. GitHub is never touched.',
    response: ProjectRemoveResult,
    parameters: [projectParameter],
    request: z.object({
      confirmation: z.string(),
      volumes: z.boolean(),
      directory: z.boolean(),
      overrideDirty: z.boolean().optional(),
    }).strict(),
    errors: [400, 403, 404, 409, 500, 502],
  }), async (c) => {
    const snapshot = await deps.cache.get()
    const body = await c.req.json() as {
      confirmation: string
      volumes: boolean
      directory: boolean
      overrideDirty?: boolean
    }
    const result = await removeProject(
      deps.client, snapshot, deps.config, deps.db, c.req.param('project'), body,
    )
    deps.cache.invalidate()
    return c.json(result)
  })

  for (const action of ['start', 'stop', 'restart'] as const) {
    app.post(`/projects/:project/actions/${action}`, documentRoute({
      tag: 'Projects',
      operationId: `${action}Project`,
      summary: `${action[0]?.toUpperCase()}${action.slice(1)} every container in a project`,
      description: 'Iterates the project\'s existing containers in Compose dependency order. Nothing is removed.',
      response: ProjectActionResult,
      parameters: [projectParameter],
      errors: [403, 404, 409, 500, 502],
    }), async (c) => {
      const snapshot = await deps.cache.get()
      const result = await runProjectAction(deps.client, snapshot, c.req.param('project'), action)
      deps.cache.invalidate()
      return c.json(result)
    })
  }

  return app
}
