import { Hono } from 'hono'
import type { AppDeps } from './deps.ts'
import { HostResources } from '../../shared/types.ts'
import { hostResources } from '../core/host.ts'
import { documentRoute } from '../openapi.ts'

export function hostRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  app.get('/host', documentRoute({
    tag: 'Status',
    operationId: 'getHostResources',
    summary: 'Get this host\'s capacity right now',
    response: HostResources,
    description:
      'Merges GET /info (static host facts) with state/host/host.json from `portta host collect`. A missing file is a smaller object, never an error. No history.',
    errors: [500, 502],
  }), async (c) => {
    const snapshot = await deps.cache.get()
    return c.json(hostResources(snapshot.info, deps.config))
  })

  return app
}
