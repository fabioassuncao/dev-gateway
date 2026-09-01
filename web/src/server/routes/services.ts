import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppDeps } from './deps.ts'
import { findContainer } from '../core/actions.ts'
import type { LogsResponse } from '../../shared/types.ts'

const MAX_TAIL = 2000

export function serviceRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  // A "service" is a container that belongs to an integrated project. It is the
  // same object the Docker page shows, filtered to what the gateway manages.
  app.get('/services', async (c) => {
    const snapshot = await deps.cache.get()
    const project = c.req.query('project')
    const integrated = new Set(
      snapshot.projects.filter((item) => item.integrated).map((item) => item.name),
    )
    const services = snapshot.containers.filter(
      (container) =>
        container.project !== null &&
        integrated.has(container.project) &&
        (project === undefined || container.project === project),
    )
    return c.json({ services })
  })

  app.get('/services/:id', async (c) => {
    const snapshot = await deps.cache.get()
    const container = findContainer(snapshot, c.req.param('id'))
    return c.json(container)
  })

  app.get('/services/:id/logs', async (c) => c.json(await readLogs(deps, c.req.param('id'), c.req.query('tail'))))

  return app
}

export async function readLogs(deps: AppDeps, id: string, tailParam?: string): Promise<LogsResponse> {
  const snapshot = await deps.cache.get()
  const container = findContainer(snapshot, id)
  const requested = Number(tailParam ?? '200')
  const tail = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), MAX_TAIL) : 200

  const lines = await deps.client.logs(container.id, { tail }).catch((cause: Error) => {
    throw new HTTPException(502, { message: `could not read logs: ${cause.message}` })
  })

  return {
    containerId: container.id,
    name: container.name,
    lines,
    truncated: lines.length >= tail,
  }
}
