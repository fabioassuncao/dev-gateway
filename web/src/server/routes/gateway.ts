import { Hono } from 'hono'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import type { AppDeps } from './deps.ts'
import { componentOf, gatewayStatus, RESTARTABLE_COMPONENTS } from '../core/gateway.ts'
import { diagnose } from '../core/diagnostics.ts'
import { readLogs } from './services.ts'

const restartBody = z
  .object({ components: z.array(z.enum(RESTARTABLE_COMPONENTS)).min(1).optional() })
  .strict()

export function gatewayRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  app.get('/gateway', async (c) => {
    const snapshot = await deps.cache.get()
    return c.json(gatewayStatus(snapshot, deps.config))
  })

  // The diagnostics a container can make honestly. `dev-gateway doctor` stays
  // the deeper, host-level tool: it sees PATH, listening sockets, DNS and the
  // certificate files, which this process cannot.
  app.post('/gateway/doctor', async (c) => {
    const snapshot = await deps.cache.get(true)
    const checks = diagnose(snapshot, deps.config)
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
  app.post('/gateway/restart', async (c) => {
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

  app.get('/gateway/logs', async (c) => {
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
