import { Hono } from 'hono'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import type { AppDeps } from './deps.ts'
import { findContainer } from '../core/actions.ts'
import { dashboardRouterUrl, routersFor } from '../core/traefik.ts'
import { ContainerSummary, LogsResponse, ServiceTraefik } from '../../shared/types.ts'
import { containerIdParameter, documentRoute, tailParameter } from '../openapi.ts'

const MAX_TAIL = 2000
export const ServicesResponse = z.object({ services: z.array(ContainerSummary) }).strict().meta({ ref: 'ServicesResponse' })

export function serviceRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  // A "service" is a container that belongs to an integrated project. It is the
  // same object the Docker page shows, filtered to what the gateway manages.
  app.get('/services', documentRoute({
    tag: 'Services', operationId: 'listServices', capability: 'service:read', summary: 'List services in adopted projects', response: ServicesResponse,
    parameters: [{ name: 'project', in: 'query', required: false, description: 'Filter by COMPOSE_PROJECT_NAME.', schema: { type: 'string' } }],
    errors: [500, 502],
  }), async (c) => {
    const snapshot = await deps.cache.get()
    const project = c.req.query('project')
    const integrated = new Set(
      snapshot.environments.filter((item) => item.integrated).map((item) => item.name),
    )
    const services = snapshot.containers.filter(
      (container) =>
        container.environment !== null &&
        !container.oneOff &&
        integrated.has(container.environment) &&
        (project === undefined || container.environment === project),
    )
    return c.json({ services })
  })

  app.get('/services/:id', documentRoute({
    tag: 'Services', operationId: 'getService', capability: 'service:read', summary: 'Get one service container', response: ContainerSummary,
    parameters: [containerIdParameter], errors: [404, 500, 502],
  }), async (c) => {
    const snapshot = await deps.cache.get()
    const container = findContainer(snapshot, c.req.param('id'))
    return c.json(container)
  })

  app.get('/services/:id/logs', documentRoute({
    tag: 'Services', operationId: 'getServiceLogs', capability: 'logs:read', summary: 'Read recent service logs', response: LogsResponse,
    parameters: [containerIdParameter, tailParameter], errors: [404, 500, 502],
  }), async (c) => c.json(await readLogs(deps, c.req.param('id'), c.req.query('tail'))))

  /**
   * What Traefik says about this service, beside what its labels say. Off its
   * own cache and its own timeout: an unreachable Traefik API answers
   * `available: false` with the reason, and the rest of the panel is unaffected.
   */
  app.get('/services/:id/traefik', documentRoute({
    tag: 'Services', operationId: 'getServiceTraefik', capability: 'service:read', summary: "Get Traefik's verdict for a service", response: ServiceTraefik,
    parameters: [containerIdParameter], errors: [404, 500, 502],
  }), async (c) => {
    const snapshot = await deps.cache.get()
    const container = findContainer(snapshot, c.req.param('id'))
    const verdict = await deps.verdict.get()

    const body: ServiceTraefik = {
      containerId: container.id,
      available: verdict.available,
      reason: verdict.reason,
      expectedHosts: container.urls.map((url) => url.host),
      routers: routersFor(container, verdict).map((router) => ({
        ...router,
        dashboardUrl: dashboardRouterUrl(deps.config, router.name),
      })),
      fetchedAt: verdict.fetchedAt,
    }
    return c.json(body)
  })

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
