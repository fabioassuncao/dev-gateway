import { Hono } from 'hono'
import { z } from 'zod'
import type { AppDeps } from './deps.ts'
import { HTTPException } from 'hono/http-exception'
import { readProjectGit } from '../core/git.ts'
import { mergeLogSources, type LogSourceLines } from '../core/projectlogs.ts'
import { applyOverrides, loadOverrides } from '../core/overrides.ts'
import { Project, ProjectGit, ProjectLogsResponse, type ProjectLogSource } from '../../shared/types.ts'
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
    return c.json(applyOverrides([project], await loadOverrides(deps.db))[0]!)
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
    return c.json(readProjectGit(deps.config, name))
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

  return app
}
