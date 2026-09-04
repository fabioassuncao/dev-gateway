import { Hono } from 'hono'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import type { AppDeps } from '../../deps.ts'
import { buildConfigView, patchConfig } from '../../services/configview.ts'
import { ConfigPatchResult, ConfigView } from 'portta-contracts'
import { documentRoute } from '../openapi.ts'

const patchBody = z
  .object({ values: z.record(z.string(), z.union([z.string().max(4096), z.null()])) })
  .strict()

export function configRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  // Secret values never appear here: the response says whether a token is set,
  // and nothing more.
  app.get('/config', documentRoute({
    tag: 'Configuration', operationId: 'getConfig', capability: 'config:read', summary: 'Get the managed settings catalogue',
    description: 'Secret values are never returned; only whether they are set.', response: ConfigView,
    errors: [500],
  }), (c) => c.json(buildConfigView(deps.config)))

  app.patch('/config', documentRoute({
    tag: 'Configuration', operationId: 'patchConfig', capability: 'config:write', summary: 'Save managed settings',
    response: ConfigPatchResult, request: patchBody, errors: [400, 403, 500],
  }), async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = patchBody.safeParse(body)
    if (!parsed.success) {
      throw new HTTPException(400, { message: 'send {"values": {"KEY": "value"}}' })
    }
    return c.json(patchConfig(deps.config, parsed.data.values))
  })

  return app
}
