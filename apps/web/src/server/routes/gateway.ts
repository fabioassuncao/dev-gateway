import { Hono } from 'hono'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import type { AppDeps } from './deps.ts'
import { componentOf, gatewayStatus, RESTARTABLE_COMPONENTS } from '../core/gateway.ts'
import { loadAliases } from '../core/overrides.ts'
import { diagnose } from '../core/diagnostics.ts'
import { readLogs } from './services.ts'
import { Diagnostic, GatewayStatus, LogsResponse, TraefikVerdict } from '../../shared/types.ts'
import { documentRoute, tailParameter } from '../openapi.ts'
import { unavailableDatabaseStatus } from '../db/index.ts'

const restartBody = z
  .object({ components: z.array(z.enum(RESTARTABLE_COMPONENTS)).min(1).optional() })
  .strict()

export const DoctorResponse = z.object({
  checks: z.array(Diagnostic), failures: z.number().int(), warnings: z.number().int(),
  ranAt: z.number(), hostCommand: z.string(),
}).strict().meta({ ref: 'DoctorResponse' })
export const RestartResponse = z.object({
  ok: z.literal(true), restarted: z.array(z.string()), missing: z.array(z.string()),
  note: z.string(), applyCommand: z.string(),
}).strict().meta({ ref: 'RestartResponse' })

export function gatewayRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  app.get('/gateway', documentRoute({
    tag: 'Gateway', operationId: 'getGateway', summary: 'Get gateway component status',
    response: GatewayStatus, errors: [500, 502],
  }), async (c) => {
    const snapshot = await deps.cache.get()
    return c.json(gatewayStatus(snapshot, deps.config))
  })

  // The diagnostics a container can make honestly. `dev-gateway doctor` stays
  // the deeper, host-level tool: it sees PATH, listening sockets, DNS and the
  // certificate files, which this process cannot.
  app.post('/gateway/doctor', documentRoute({
    tag: 'Gateway', operationId: 'runGatewayDoctor', summary: 'Run container-visible diagnostics',
    response: DoctorResponse, errors: [403, 500, 502],
  }), async (c) => {
    const snapshot = await deps.cache.get(true)
    // Traefik's verdict is worth a network call here, where the user asked for
    // diagnostics, and never on a page render.
    const verdict = await deps.verdict.get(true)
    const checks = diagnose(
      snapshot,
      deps.config,
      verdict,
      [],
      deps.db?.status() ??
        unavailableDatabaseStatus(deps.config.databaseUrl !== null, 'PostgreSQL was unavailable at startup'),
      loadAliases(deps.config),
    )
    return c.json({
      checks,
      failures: checks.filter((check) => check.status === 'fail').length,
      warnings: checks.filter((check) => check.status === 'warn').length,
      ranAt: Math.floor(Date.now() / 1000),
      hostCommand: './bin/dev-gateway doctor',
    })
  })

  /**
   * Restarts gateway components in place. Traefik reads its static
   * configuration from the environment it was created with, so a settings
   * change still needs `dev-gateway up` on the host: the response says so
   * rather than pretending otherwise.
   */
  app.post('/gateway/restart', documentRoute({
    tag: 'Gateway', operationId: 'restartGateway', summary: 'Restart selected gateway components',
    response: RestartResponse, request: restartBody, errors: [400, 403, 409, 500, 502],
  }), async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const parsed = restartBody.safeParse(body)
    if (!parsed.success) throw new HTTPException(400, { message: 'unknown restart request' })

    const wanted = parsed.data.components ?? ['traefik']
    const snapshot = await deps.cache.get(true)
    const restarted: string[] = []
    const missing: string[] = []

    for (const component of wanted) {
      const container = componentOf(snapshot, component)
      if (!container) {
        missing.push(component)
        continue
      }
      await deps.client.restart(container.id)
      restarted.push(component)
    }
    deps.cache.invalidate()

    if (restarted.length === 0) {
      throw new HTTPException(409, {
        message: `no running gateway component to restart (${missing.join(', ')})`,
      })
    }

    return c.json({
      ok: true,
      restarted,
      missing,
      note: 'settings saved in .env take effect once the containers are recreated',
      applyCommand: `./bin/dev-gateway up ${deps.config.profile}`,
    })
  })

  /**
   * Traefik's own routing table. The panel links into the dashboard rather than
   * rebuilding it: this is the verdict, not a replacement view.
   */
  app.get('/gateway/traefik', documentRoute({
    tag: 'Gateway', operationId: 'getTraefikVerdict', summary: "Get Traefik's routing table", response: TraefikVerdict,
    errors: [500, 502],
  }), async (c) => c.json(await deps.verdict.get()))

  app.get('/gateway/logs', documentRoute({
    tag: 'Gateway', operationId: 'getGatewayLogs', summary: 'Read gateway component logs', response: LogsResponse,
    parameters: [
      { name: 'component', in: 'query', required: false, description: 'Gateway component name.', schema: { type: 'string', enum: [...RESTARTABLE_COMPONENTS], default: 'traefik' } },
      tailParameter,
    ], errors: [400, 404, 500, 502],
  }), async (c) => {
    const component = c.req.query('component') ?? 'traefik'
    const allowed: readonly string[] = RESTARTABLE_COMPONENTS
    if (!allowed.includes(component)) {
      throw new HTTPException(400, { message: `unknown gateway component: ${component}` })
    }
    const snapshot = await deps.cache.get()
    const container = componentOf(snapshot, component)
    if (!container) throw new HTTPException(404, { message: `${component} is not running` })
    return c.json(await readLogs(deps, container.id, c.req.query('tail')))
  })

  return app
}
