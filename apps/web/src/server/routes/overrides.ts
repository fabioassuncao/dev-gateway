import { Hono } from 'hono'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import type { AppDeps } from './deps.ts'
import { requireDatabase } from '../db/index.ts'
import { PROJECT_KEYS, type ProjectSettingKey } from '../db/keys.ts'
import {
  loadAliases,
  OverrideRefused,
  planAlias,
  saveAliases,
  sortAliases,
} from '../core/overrides.ts'
import { ProjectOverrides, ServiceOverrides } from '../../shared/types.ts'
import { documentRoute, projectParameter } from '../openapi.ts'

const serviceParameter = {
  name: 'service',
  in: 'path' as const,
  required: true,
  description: 'Compose service name within the project.',
  schema: { type: 'string' as const },
}

/** Every project override, and `null` for anything the user cleared. */
const ProjectSettingsBody = z
  .object({
    displayName: z.string().min(1).max(120).nullable(),
    description: z.string().max(2000).nullable(),
    color: z.string().regex(/^#[0-9a-f]{6}$/i).nullable(),
    pinned: z.boolean().nullable(),
    archived: z.boolean().nullable(),
    primaryService: z.string().min(1).max(128).nullable(),
    hiddenServices: z.array(z.string().min(1).max(128)).max(256).nullable(),
    serviceOrder: z.array(z.string().min(1).max(128)).max(256).nullable(),
  })
  .partial()
  .strict()
  .meta({ ref: 'ProjectSettingsBody' })

const AliasBody = z
  .object({ alias: z.string().min(1).max(253) })
  .strict()
  .meta({ ref: 'AliasBody' })

const AliasResult = z
  .object({
    project: z.string(),
    service: z.string(),
    host: z.string().describe('The hostname Traefik now answers on, beside the derived one'),
    derivedHosts: z.array(z.string()).describe('What the project itself declares; never replaced'),
    port: z.number().int(),
    entryPoint: z.string(),
    file: z.string().describe('The generated Traefik file this was written to'),
  })
  .strict()
  .meta({ ref: 'AliasResult' })

/**
 * The UI invalidates on Docker events already; an override is a change it can
 * see the same way rather than a second refresh mechanism.
 */
function announce(deps: AppDeps, project: string): void {
  deps.hub.publish({
    kind: 'config',
    action: 'overrides',
    id: null,
    name: null,
    project,
    ownership: null,
    at: Math.floor(Date.now() / 1000),
  })
}

export function overrideRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  async function projectRecord(name: string) {
    const snapshot = await deps.cache.get()
    if (!snapshot.projects.some((item) => item.name === name)) {
      throw new HTTPException(404, { message: `no project '${name}' is running` })
    }
    const db = requireDatabase(deps.db)
    // Identity is COMPOSE_PROJECT_NAME, so two worktrees are two environments
    // with two sets of overrides. A new worktree starts blank, deliberately.
    const record = (await db.projects.find(name)) ?? (await db.projects.upsertSeen({ composeProject: name }))
    return { db, record, snapshot }
  }

  app.get('/projects/:project/settings', documentRoute({
    tag: 'Projects', operationId: 'getProjectSettings', summary: 'Read a project\'s overrides',
    response: ProjectOverrides, parameters: [projectParameter], errors: [404, 500, 503],
  }), async (c) => {
    const { db, record } = await projectRecord(c.req.param('project'))
    const stored: Record<string, unknown> = {}
    for (const key of Object.keys(PROJECT_KEYS) as ProjectSettingKey[]) {
      const value = await db.settings.getProject(record.id, key)
      if (value !== null) stored[key] = value
    }
    return c.json(stored)
  })

  app.put('/projects/:project/settings', documentRoute({
    tag: 'Projects', operationId: 'setProjectSettings', summary: 'Set or clear a project\'s overrides',
    description: 'Presentation only: nothing here changes routing, and nothing is written inside the project.',
    request: ProjectSettingsBody, response: ProjectOverrides,
    parameters: [projectParameter], errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const body = ProjectSettingsBody.parse(await c.req.json())
    const { db, record } = await projectRecord(c.req.param('project'))

    for (const [key, value] of Object.entries(body) as [ProjectSettingKey, unknown][]) {
      if (value === null) await db.settings.clearProject(record.id, key)
      else await db.settings.setProject(record.id, key, value as never)
    }

    const stored: Record<string, unknown> = {}
    for (const key of Object.keys(PROJECT_KEYS) as ProjectSettingKey[]) {
      const value = await db.settings.getProject(record.id, key)
      if (value !== null) stored[key] = value
    }
    announce(deps, c.req.param('project'))
    return c.json(stored)
  })

  app.delete('/projects/:project/settings', documentRoute({
    tag: 'Projects', operationId: 'clearProjectSettings', summary: 'Remove every override on a project',
    response: z.object({ ok: z.boolean(), cleared: z.array(z.string()) }).strict().meta({ ref: 'ClearedSettings' }),
    parameters: [projectParameter], errors: [403, 404, 500, 503],
  }), async (c) => {
    const { db, record } = await projectRecord(c.req.param('project'))
    const cleared: string[] = []
    for (const key of Object.keys(PROJECT_KEYS) as ProjectSettingKey[]) {
      if ((await db.settings.getProject(record.id, key)) === null) continue
      await db.settings.clearProject(record.id, key)
      cleared.push(key)
    }
    announce(deps, c.req.param('project'))
    return c.json({ ok: true, cleared })
  })

  app.get('/projects/:project/services/:service/overrides', documentRoute({
    tag: 'Projects', operationId: 'getServiceOverrides', summary: 'Read one service\'s overrides',
    response: ServiceOverrides, parameters: [projectParameter, serviceParameter], errors: [404, 500, 503],
  }), async (c) => {
    const { db, record } = await projectRecord(c.req.param('project'))
    const service = c.req.param('service')
    const stored: Record<string, unknown> = {}
    for (const key of ['alias', 'note', 'hidden'] as const) {
      const value = await db.settings.getService(record.id, service, key)
      if (value !== null) stored[key] = value
    }
    return c.json(stored)
  })

  app.put('/projects/:project/services/:service/note', documentRoute({
    tag: 'Projects', operationId: 'setServiceNote', summary: 'Set or clear a note on a service',
    request: z.object({ note: z.string().max(2000).nullable() }).strict().meta({ ref: 'ServiceNoteBody' }),
    response: ServiceOverrides, parameters: [projectParameter, serviceParameter],
    errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const body = z.object({ note: z.string().max(2000).nullable() }).strict().parse(await c.req.json())
    const { db, record } = await projectRecord(c.req.param('project'))
    const service = c.req.param('service')
    if (body.note === null) await db.settings.clearService(record.id, service, 'note')
    else await db.settings.setService(record.id, service, 'note', body.note)
    announce(deps, c.req.param('project'))
    return c.json(body.note === null ? {} : { note: body.note })
  })

  /**
   * The one override that leaves the panel.
   *
   * Row and file are written as one operation: the generated file is rendered
   * whole from the stored state, and a failed write rolls the row back, so the
   * database and Traefik cannot end up disagreeing about what answers.
   */
  app.put('/projects/:project/services/:service/alias', documentRoute({
    tag: 'Projects', operationId: 'setServiceAlias', summary: 'Route an additional hostname to a service',
    description:
      'Additive: the project\'s own hostname keeps working beside the alias. Refused before any write when the hostname collides, sits outside a served domain, or has no unambiguous HTTP port.',
    request: AliasBody, response: AliasResult,
    parameters: [projectParameter, serviceParameter], errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const body = AliasBody.parse(await c.req.json())
    const projectName = c.req.param('project')
    const service = c.req.param('service')
    const { db, record, snapshot } = await projectRecord(projectName)

    const existing = loadAliases(deps.config)
    const planned = planAlias({ project: projectName, service, alias: body.alias }, snapshot, existing, deps.config)

    const previous = await db.settings.getService(record.id, service, 'alias')
    await db.settings.setService(record.id, service, 'alias', planned.host)

    try {
      const next = sortAliases([
        ...existing.filter((alias) => !(alias.project === projectName && alias.service === service)),
        planned,
      ])
      saveAliases(deps.config, next)
    } catch (cause) {
      if (previous === null) await db.settings.clearService(record.id, service, 'alias')
      else await db.settings.setService(record.id, service, 'alias', previous)
      throw cause
    }

    const target = snapshot.projects
      .find((item) => item.name === projectName)!
      .services.find((item) => (item.service ?? item.name) === service)!

    announce(deps, c.req.param('project'))
    return c.json({
      project: projectName,
      service,
      host: planned.host,
      derivedHosts: target.urls.map((url) => url.host),
      port: planned.port,
      entryPoint: planned.entryPoint,
      file: 'dev-gateway-aliases.yaml',
    })
  })

  app.delete('/projects/:project/services/:service/alias', documentRoute({
    tag: 'Projects', operationId: 'clearServiceAlias', summary: 'Remove a hostname alias',
    response: z.object({ ok: z.boolean(), removed: z.string().nullable() }).strict().meta({ ref: 'AliasRemoval' }),
    parameters: [projectParameter, serviceParameter], errors: [403, 404, 500, 503],
  }), async (c) => {
    const projectName = c.req.param('project')
    const service = c.req.param('service')
    const { db, record } = await projectRecord(projectName)

    const existing = loadAliases(deps.config)
    const removed = existing.find((alias) => alias.project === projectName && alias.service === service) ?? null

    await db.settings.clearService(record.id, service, 'alias')
    saveAliases(
      deps.config,
      sortAliases(existing.filter((alias) => !(alias.project === projectName && alias.service === service))),
    )

    announce(deps, c.req.param('project'))
    return c.json({ ok: true, removed: removed?.host ?? null })
  })

  return app
}

export { OverrideRefused }
