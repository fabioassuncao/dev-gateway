import { Hono } from 'hono'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import type { AppDeps } from './deps.ts'
import { closeBridge, listBridges, listForwarders, listTcpServices, openBridge } from '../core/access.ts'
import { AccessView, Bridge } from '../../shared/types.ts'
import { documentRoute, shareIdParameter } from '../openapi.ts'

const openBody = z
  .object({
    project: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/),
    service: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/),
    port: z.number().int().min(1).max(65535).optional(),
    localPort: z.number().int().min(1024).max(65535).optional(),
    ttlSeconds: z.number().int().min(30).max(86400).optional(),
  })
  .strict()

export const OpenBridgeResponse = z.object({ ok: z.literal(true), bridge: Bridge.nullable() }).strict().meta({ ref: 'OpenBridgeResponse' })
export const CloseBridgeResponse = z.object({ ok: z.literal(true), message: z.string() }).strict().meta({ ref: 'CloseBridgeResponse' })

export function accessRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  app.get('/access', documentRoute({
    tag: 'Access', operationId: 'getAccess', summary: 'List private TCP services and temporary bridges',
    response: AccessView, errors: [500, 502],
  }), async (c) => {
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
  app.post('/access', documentRoute({
    tag: 'Access', operationId: 'openAccess', summary: 'Open a loopback bridge to a TCP service',
    description: 'The panel always binds the bridge to 127.0.0.1.', response: OpenBridgeResponse,
    status: 201, request: openBody, errors: [400, 403, 404, 409, 500, 502],
  }), async (c) => {
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

  app.delete('/access/:id', documentRoute({
    tag: 'Access', operationId: 'closeAccess', summary: 'Close a gateway-owned bridge',
    response: CloseBridgeResponse, parameters: [shareIdParameter], errors: [400, 403, 404, 500, 502],
  }), async (c) => {
    const snapshot = await deps.cache.get(true)
    await closeBridge(deps.client, snapshot, c.req.param('id'))
    deps.cache.invalidate()
    return c.json({ ok: true, message: 'bridge closed; the service itself was not touched' })
  })

  return app
}
