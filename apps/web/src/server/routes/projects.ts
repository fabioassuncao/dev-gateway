import { Hono } from 'hono'
import { z } from 'zod'
import { parseRelativeProjectPath } from 'portta-core'
import { HTTPException } from 'hono/http-exception'
import type { AppDeps } from './deps.ts'
import { requireDatabase, type Database } from '../db/index.ts'
import { OverrideRefused } from '../core/overrides.ts'
import type { Snapshot } from '../core/inventory.ts'
import { loadProjectCatalog, toProject, toProjectSummary } from '../core/catalog.ts'
import { Project, ProjectSummary } from '../../shared/types.ts'
import { documentRoute } from '../openapi.ts'

const slugParameter = {
  name: 'slug',
  in: 'path' as const,
  required: true,
  description: 'The Project slug, as created.',
  schema: { type: 'string' as const },
}

const ProjectsResponse = z
  .object({ projects: z.array(ProjectSummary) })
  .strict()
  .meta({ ref: 'ProjectsResponse' })

/**
 * First-level directory under Projects Home (ADR 0031). Validated here so a
 * bad path is a 400 with the reason, and again in the repository.
 */
const RelativePath = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => {
    try {
      parseRelativeProjectPath(value)
      return true
    } catch {
      return false
    }
  }, {
    message: 'relativePath must be one directory name under Projects Home: no slashes, no dots, never absolute',
  })
  .describe('First-level directory under Projects Home. Never an absolute path.')

const CreateBody = z
  .object({
    slug: z.string().min(1).max(64).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
    name: z.string().min(1).max(120),
    description: z.string().max(2000).nullable().optional(),
    relativePath: RelativePath.nullable().optional(),
  })
  .strict()
  .meta({ ref: 'CreateProjectBody' })

const PatchBody = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(2000).nullable().optional(),
    archived: z.boolean().optional(),
    relativePath: RelativePath.nullable().optional(),
  })
  .strict()
  .meta({ ref: 'PatchProjectBody' })

const RepositoriesBody = z
  .object({
    repositories: z
      .array(
        z.object({ fullName: z.string().min(1), role: z.string().max(32).nullable().optional() }).strict(),
      )
      .max(64),
  })
  .strict()
  .meta({ ref: 'ProjectRepositoriesBody' })

const EnvironmentsBody = z
  .object({ environments: z.array(z.string().min(1).max(255)).max(128) })
  .strict()
  .meta({ ref: 'ProjectEnvironmentsBody' })

const Removal = z
  .object({
    ok: z.boolean(),
    removed: z.string(),
    note: z.string().describe('States what was not touched, because that is the question'),
  })
  .strict()
  .meta({ ref: 'ProjectRemoval' })

/**
 * Joins the operator's decisions with what is actually running.
 *
 * The repository and environment lists come from the database; the runtime
 * half comes from the snapshot the panel already has, so a Project with
 * nothing up is a full answer rather than an empty one.
 */
async function assemble(db: Database, snapshot: Snapshot, projectsHome: string | null) {
  return loadProjectCatalog(db, snapshot, projectsHome)
}

function summariesFrom(catalog: Awaited<ReturnType<typeof loadProjectCatalog>>) {
  return catalog.records.map((record) =>
    toProjectSummary(
      record,
      (catalog.githubByProject.get(record.id) ?? []).length,
      catalog.environments.get(record.id) ?? [],
    ),
  )
}

/** A Zod failure on a stored decision is the caller's mistake, said plainly. */
function refusedOnValidation<T>(work: () => Promise<T>): Promise<T> {
  return work().catch((error: unknown) => {
    if (error instanceof z.ZodError) {
      throw new OverrideRefused(error.issues.map((issue) => issue.message).join('; '))
    }
    throw error
  })
}

export function projectRoutes(deps: AppDeps): Hono {
  const app = new Hono()
  const home = () => deps.config.projectsHome

  app.get('/projects', documentRoute({
    tag: 'Projects', operationId: 'listProjects', summary: 'List Projects',
    response: ProjectsResponse,
    description: 'A Project is the product the operator recognises. It stays visible with nothing running. See ADR 0031.',
    errors: [500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const catalog = await assemble(db, await deps.cache.get(), home())
    return c.json({ projects: summariesFrom(catalog) })
  })

  app.post('/projects', documentRoute({
    tag: 'Projects', operationId: 'createProject', summary: 'Create a Project',
    request: CreateBody, response: Project, status: 201,
    description: 'Persists the product. Nothing on this host is started or stopped. relativePath places it under Projects Home; files are never moved.',
    errors: [400, 403, 409, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const body = CreateBody.parse(await c.req.json())
    if (await db.projects.find(body.slug)) {
      throw new HTTPException(409, { message: `a project named '${body.slug}' already exists` })
    }
    const created = await refusedOnValidation(() =>
      db.projects.create({ ...body, description: body.description ?? null, relativePath: body.relativePath ?? null }),
    )
    return c.json(toProject(created, [], [], home()), 201)
  })

  app.get('/projects/:slug', documentRoute({
    tag: 'Projects', operationId: 'getProject', summary: 'Get one Project',
    response: Project, parameters: [slugParameter], errors: [404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const slug = c.req.param('slug')
    const record = await db.projects.find(slug)
    if (!record) throw new HTTPException(404, { message: `no project '${slug}'` })
    const catalog = await assemble(db, await deps.cache.get(), home())
    return c.json(toProject(
      record,
      catalog.githubByProject.get(record.id) ?? [],
      catalog.environments.get(record.id) ?? [],
      home(),
    ))
  })

  app.patch('/projects/:slug', documentRoute({
    tag: 'Projects', operationId: 'patchProject', summary: 'Rename, describe, place or archive a Project',
    request: PatchBody, response: ProjectSummary,
    parameters: [slugParameter], errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const slug = c.req.param('slug')
    const patch = PatchBody.parse(await c.req.json())
    const updated = await refusedOnValidation(() => db.projects.update(slug, patch))
    if (!updated) throw new HTTPException(404, { message: `no project '${slug}'` })
    return c.json(toProjectSummary(updated, 0, []))
  })

  /**
   * Removes the grouping and nothing else.
   *
   * This is the endpoint most likely to be misread, so it says what it did not
   * do: no container is stopped, no volume is removed, no environment is
   * changed and no repository is unlinked from GitHub.
   */
  app.delete('/projects/:slug', documentRoute({
    tag: 'Projects', operationId: 'deleteProject', summary: 'Remove a Project grouping',
    description: 'Deletes the grouping only. No container, volume, environment or repository is touched.',
    response: Removal, parameters: [slugParameter], errors: [403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const slug = c.req.param('slug')
    if (!(await db.projects.remove(slug))) {
      throw new HTTPException(404, { message: `no project '${slug}'` })
    }
    return c.json({
      ok: true,
      removed: slug,
      note: 'the grouping only: no container, volume, environment or repository was touched',
    })
  })

  app.put('/projects/:slug/repositories', documentRoute({
    tag: 'Projects', operationId: 'setProjectRepositories',
    summary: 'Set the GitHub repositories a Project owns',
    description: 'A repository the GitHub App installation did not grant is refused; the projection is the authorisation boundary.',
    request: RepositoriesBody, response: Project,
    parameters: [slugParameter], errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const slug = c.req.param('slug')
    const record = await db.projects.find(slug)
    if (!record) throw new HTTPException(404, { message: `no project '${slug}'` })

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
    await db.projects.setRepositories(record.id, links)

    const catalog = await assemble(db, await deps.cache.get(), home())
    return c.json(toProject(
      record,
      catalog.githubByProject.get(record.id) ?? [],
      catalog.environments.get(record.id) ?? [],
      home(),
    ))
  })

  app.put('/projects/:slug/environments', documentRoute({
    tag: 'Projects', operationId: 'setProjectEnvironments',
    summary: 'Set the environments a Project adopts by hand',
    description: 'A manual mapping always wins over portta.project and over a repository match.',
    request: EnvironmentsBody, response: Project,
    parameters: [slugParameter], errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const slug = c.req.param('slug')
    const record = await db.projects.find(slug)
    if (!record) throw new HTTPException(404, { message: `no project '${slug}'` })

    const body = EnvironmentsBody.parse(await c.req.json())
    const snapshot = await deps.cache.get()
    for (const name of body.environments) {
      if (!snapshot.environments.some((environment) => environment.name === name)) {
        throw new OverrideRefused(`no environment '${name}' is running`)
      }
    }
    await db.projects.setEnvironments(record.id, body.environments)

    const catalog = await assemble(db, await deps.cache.get(true), home())
    return c.json(toProject(
      record,
      catalog.githubByProject.get(record.id) ?? [],
      catalog.environments.get(record.id) ?? [],
      home(),
    ))
  })

  return app
}
