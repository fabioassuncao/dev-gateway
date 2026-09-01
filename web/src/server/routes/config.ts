import { Hono } from 'hono'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import type { AppDeps } from './deps.ts'
import { buildConfigView, patchConfig } from '../core/configview.ts'

const patchBody = z
  .object({ values: z.record(z.string(), z.union([z.string().max(4096), z.null()])) })
  .strict()

export function configRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  // Secret values never appear here: the response says whether a token is set,
  // and nothing more.
  app.get('/config', (c) => c.json(buildConfigView(deps.config)))

  app.patch('/config', async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = patchBody.safeParse(body)
    if (!parsed.success) {
      throw new HTTPException(400, { message: 'send {"values": {"KEY": "value"}}' })
    }
    return c.json(patchConfig(deps.config, parsed.data.values))
  })

  return app
}
