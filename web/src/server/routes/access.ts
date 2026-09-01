import { Hono } from 'hono'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import type { AppDeps } from './deps.ts'
import { closeBridge, listBridges, listForwarders, listTcpServices, openBridge } from '../core/access.ts'
import type { AccessView } from '../../shared/types.ts'

const openBody = z
  .object({
    project: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/),
    service: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/),
    port: z.number().int().min(1).max(65535).optional(),
    localPort: z.number().int().min(1024).max(65535).optional(),
    ttlSeconds: z.number().int().min(30).max(86400).optional(),
  })
  .strict()

export function accessRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  app.get('/access', async (c) => {
    const snapshot = await deps.cache.get()
    const view: AccessView = {
      services: listTcpServices(snapshot, deps.config),
      bridges: listBridges(snapshot),
      forwarders: listForwarders(snapshot),
      bridgeImageHint: deps.config.bridgeImage,
      tcpRoutingEnabled: deps.config.tcpEnabled,
    }
    return c.json(view)
  })

  // Opens the same loopback bridge `dev-gateway access open` creates. The
  // panel offers no way to bind it anywhere but 127.0.0.1.
  app.post('/access', async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = openBody.safeParse(body)
    if (!parsed.success) {
      throw new HTTPException(400, {
        message: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
      })
    }

    const snapshot = await deps.cache.get(true)
    const opened = await openBridge(deps.client, snapshot, deps.config, parsed.data)
    deps.cache.invalidate()

    const refreshed = await deps.cache.get(true)
    const bridge = listBridges(refreshed).find((item) => item.id === opened.bridgeId) ?? null
    return c.json({ ok: true, bridge }, 201)
  })

  app.delete('/access/:id', async (c) => {
    const snapshot = await deps.cache.get(true)
    await closeBridge(deps.client, snapshot, c.req.param('id'))
    deps.cache.invalidate()
    return c.json({ ok: true, message: 'bridge closed; the service itself was not touched' })
  })

  return app
}
