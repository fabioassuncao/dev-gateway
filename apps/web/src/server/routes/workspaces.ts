import { Hono } from 'hono'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import type { AppDeps } from './deps.ts'
import { requireDatabase, type Database } from '../db/index.ts'
import { resolveAdoptions, type WorkspaceCoordinates } from '../core/adoption.ts'
import { OverrideRefused } from '../core/overrides.ts'
import type { Snapshot } from '../core/inventory.ts'
import {
  Workspace,
  WorkspaceSummary,
  type WorkspaceEnvironment,
  type WorkspaceRepository,
} from '../../shared/types.ts'
import { documentRoute } from '../openapi.ts'

const slugParameter = {
  name: 'slug',
  in: 'path' as const,
  required: true,
  description: 'The workspace slug, as created.',
  schema: { type: 'string' as const },
}

const WorkspacesResponse = z
  .object({ workspaces: z.array(WorkspaceSummary) })
  .strict()
  .meta({ ref: 'WorkspacesResponse' })

const CreateBody = z
  .object({
    slug: z.string().min(1).max(64).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
    name: z.string().min(1).max(120),
    description: z.string().max(2000).nullable().optional(),
  })
  .strict()
  .meta({ ref: 'CreateWorkspaceBody' })

const PatchBody = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(2000).nullable().optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .meta({ ref: 'PatchWorkspaceBody' })

const RepositoriesBody = z
  .object({
    repositories: z
      .array(
        z.object({ fullName: z.string().min(1), role: z.string().max(32).nullable().optional() }).strict(),
      )
      .max(64),
  })
  .strict()
  .meta({ ref: 'WorkspaceRepositoriesBody' })

const EnvironmentsBody = z
  .object({ environments: z.array(z.string().min(1).max(255)).max(128) })
  .strict()
  .meta({ ref: 'WorkspaceEnvironmentsBody' })

const Removal = z
  .object({
    ok: z.boolean(),
    removed: z.string(),
    note: z.string().describe('States what was not touched, because that is the question'),
  })
  .strict()
  .meta({ ref: 'WorkspaceRemoval' })

/**
 * Joins the user's decisions with what is actually running.
 *
 * The repository and environment lists come from the database; the runtime
 * half comes from the snapshot the panel already has, so a workspace with
 * nothing up is a full answer rather than an empty one.
 */
async function assemble(db: Database, snapshot: Snapshot) {
  const [workspaces, repositories, manualLinks] = await Promise.all([
    db.workspaces.list(),
    db.workspaces.listRepositories(),
    db.workspaces.listEnvironments(),
  ])

  const byWorkspace = new Map<string, WorkspaceRepository[]>()
  for (const row of repositories) {
    const list = byWorkspace.get(row.workspaceId) ?? []
    list.push({
      repositoryId: row.repositoryId,
      fullName: row.fullName,
      htmlUrl: row.htmlUrl,
      defaultBranch: row.defaultBranch,
      private: row.private,
      archived: row.archived,
      role: row.role,
      position: row.position,
    })
    byWorkspace.set(row.workspaceId, list)
  }

  const coordinates: WorkspaceCoordinates[] = workspaces.map((workspace) => ({
    id: workspace.id,
    slug: workspace.slug,
    repositories: (byWorkspace.get(workspace.id) ?? []).map((repository) => repository.fullName.toLowerCase()),
  }))

  const manual = new Map(manualLinks.map((row) => [row.composeProject, row.workspaceId]))
  const adoptions = resolveAdoptions(snapshot.projects, coordinates, manual)

  const environments = new Map<string, WorkspaceEnvironment[]>()
  for (const project of snapshot.projects) {
    const adoption = adoptions.get(project.name)
    if (!adoption) continue
    const list = environments.get(adoption.workspaceId) ?? []
    list.push({
      project: project.name,
      source: adoption.source,
      running: project.runningCount > 0,
      serviceCount: project.serviceCount,
      runningCount: project.runningCount,
      unhealthyCount: project.unhealthyCount,
      urls: project.urls,
    })
    environments.set(adoption.workspaceId, list)
  }

  return { workspaces, byWorkspace, environments }
}

export function workspaceRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  app.get('/workspaces', documentRoute({
    tag: 'Workspaces', operationId: 'listWorkspaces', summary: 'List workspaces',
    response: WorkspacesResponse,
    description: 'A workspace is a grouping a person created. It stays visible with nothing running.',
    errors: [500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const snapshot = await deps.cache.get()
    const { workspaces, byWorkspace, environments } = await assemble(db, snapshot)

    return c.json({
      workspaces: workspaces.map((workspace) => {
        const adopted = environments.get(workspace.id) ?? []
        return {
          slug: workspace.slug,
          name: workspace.name,
          description: workspace.description,
          archived: workspace.archived,
          repositoryCount: (byWorkspace.get(workspace.id) ?? []).length,
          environmentCount: adopted.length,
          runningEnvironmentCount: adopted.filter((environment) => environment.running).length,
        }
      }),
    })
  })

  app.post('/workspaces', documentRoute({
    tag: 'Workspaces', operationId: 'createWorkspace', summary: 'Create a workspace',
    request: CreateBody, response: Workspace, status: 201,
    errors: [400, 403, 409, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const body = CreateBody.parse(await c.req.json())
    if (await db.workspaces.find(body.slug)) {
      throw new HTTPException(409, { message: `a workspace named '${body.slug}' already exists` })
    }
    const created = await db.workspaces.create({ ...body, description: body.description ?? null })
    return c.json(
      {
        slug: created.slug,
        name: created.name,
        description: created.description,
        archived: created.archived,
        repositories: [],
        environments: [],
      },
      201,
    )
  })

  app.get('/workspaces/:slug', documentRoute({
    tag: 'Workspaces', operationId: 'getWorkspace', summary: 'Get one workspace',
    response: Workspace, parameters: [slugParameter], errors: [404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const slug = c.req.param('slug')
    const record = await db.workspaces.find(slug)
    if (!record) throw new HTTPException(404, { message: `no workspace '${slug}'` })

    const snapshot = await deps.cache.get()
    const { byWorkspace, environments } = await assemble(db, snapshot)

    return c.json({
      slug: record.slug,
      name: record.name,
      description: record.description,
      archived: record.archived,
      repositories: byWorkspace.get(record.id) ?? [],
      environments: environments.get(record.id) ?? [],
    })
  })

  app.patch('/workspaces/:slug', documentRoute({
    tag: 'Workspaces', operationId: 'patchWorkspace', summary: 'Rename, describe or archive a workspace',
    request: PatchBody, response: WorkspaceSummary,
    parameters: [slugParameter], errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const slug = c.req.param('slug')
    const patch = PatchBody.parse(await c.req.json())
    const updated = await db.workspaces.update(slug, patch)
    if (!updated) throw new HTTPException(404, { message: `no workspace '${slug}'` })

    return c.json({
      slug: updated.slug,
      name: updated.name,
      description: updated.description,
      archived: updated.archived,
      repositoryCount: 0,
      environmentCount: 0,
      runningEnvironmentCount: 0,
    })
  })

  /**
   * Removes the grouping and nothing else.
   *
   * This is the endpoint most likely to be misread, so it says what it did not
   * do: no container is stopped, no volume is removed, no environment is
   * changed and no repository is unlinked from GitHub.
   */
  app.delete('/workspaces/:slug', documentRoute({
    tag: 'Workspaces', operationId: 'deleteWorkspace', summary: 'Remove a workspace grouping',
    description: 'Deletes the grouping only. No container, volume, environment or repository is touched.',
    response: Removal, parameters: [slugParameter], errors: [403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const slug = c.req.param('slug')
    if (!(await db.workspaces.remove(slug))) {
      throw new HTTPException(404, { message: `no workspace '${slug}'` })
    }
    return c.json({
      ok: true,
      removed: slug,
      note: 'the grouping only: no container, volume, environment or repository was touched',
    })
  })

  app.put('/workspaces/:slug/repositories', documentRoute({
    tag: 'Workspaces', operationId: 'setWorkspaceRepositories',
    summary: 'Set the repositories a workspace owns',
    description: 'A repository the GitHub App installation did not grant is refused; the projection is the authorisation boundary.',
    request: RepositoriesBody, response: Workspace,
    parameters: [slugParameter], errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const slug = c.req.param('slug')
    const record = await db.workspaces.find(slug)
    if (!record) throw new HTTPException(404, { message: `no workspace '${slug}'` })

    const body = RepositoriesBody.parse(await c.req.json())
    const links: { repositoryId: string; role: string | null }[] = []
    for (const wanted of body.repositories) {
      const known = await db.github.findRepository(wanted.fullName)
      if (!known) {
        throw new OverrideRefused(
          `${wanted.fullName} is not a repository this gateway was granted`,
          'install the GitHub App on it, then run a sync; see docs/github.md',
        )
      }
      links.push({ repositoryId: known.id, role: wanted.role ?? null })
    }
    await db.workspaces.setRepositories(record.id, links)

    const snapshot = await deps.cache.get()
    const { byWorkspace, environments } = await assemble(db, snapshot)
    return c.json({
      slug: record.slug,
      name: record.name,
      description: record.description,
      archived: record.archived,
      repositories: byWorkspace.get(record.id) ?? [],
      environments: environments.get(record.id) ?? [],
    })
  })

  app.put('/workspaces/:slug/environments', documentRoute({
    tag: 'Workspaces', operationId: 'setWorkspaceEnvironments',
    summary: 'Set the environments a workspace adopts by hand',
    description: 'A manual mapping always wins over dev-gateway.project and over a repository match.',
    request: EnvironmentsBody, response: Workspace,
    parameters: [slugParameter], errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const slug = c.req.param('slug')
    const record = await db.workspaces.find(slug)
    if (!record) throw new HTTPException(404, { message: `no workspace '${slug}'` })

    const body = EnvironmentsBody.parse(await c.req.json())
    const snapshot = await deps.cache.get()
    for (const name of body.environments) {
      if (!snapshot.projects.some((project) => project.name === name)) {
        throw new OverrideRefused(`no project '${name}' is running`)
      }
    }
    await db.workspaces.setEnvironments(record.id, body.environments)

    const { byWorkspace, environments } = await assemble(db, await deps.cache.get(true))
    return c.json({
      slug: record.slug,
      name: record.name,
      description: record.description,
      archived: record.archived,
      repositories: byWorkspace.get(record.id) ?? [],
      environments: environments.get(record.id) ?? [],
    })
  })

  return app
}
