import { Hono } from 'hono'
import { z } from 'zod'
import type { AppDeps } from './deps.ts'
import { gatewayStatus } from '../core/gateway.ts'
import { loadAliases } from '../core/overrides.ts'
import { diagnose, problemsOnly } from '../core/diagnostics.ts'
import { listBridges, listForwarders } from '../core/access.ts'
import { listShares } from '../core/shares.ts'
import { Overview, OverviewCounts } from '../../shared/types.ts'
import { documentRoute } from '../openapi.ts'
import { unavailableDatabaseStatus } from '../db/index.ts'
import { githubStatusOf } from './integrations.ts'

export const HealthResponse = z.object({
  ok: z.literal(true),
  panelVersion: z.string(),
  gatewayVersion: z.string(),
}).strict().meta({ ref: 'HealthResponse' })

export function statusRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  // Liveness: answers even when Docker is unreachable, which is exactly when
  // somebody needs to know the panel itself is up.
  app.get('/health', documentRoute({
    tag: 'Status', operationId: 'getHealth', summary: 'Check panel liveness', response: HealthResponse,
    responseDescription: 'Answers even when Docker is unreachable.',
    example: { ok: true, panelVersion: '0.1.0', gatewayVersion: '0.2.0' },
  }), (c) =>
    c.json({ ok: true, panelVersion: deps.config.panelVersion, gatewayVersion: deps.config.gatewayVersion }),
  )

  app.get('/status', documentRoute({
    tag: 'Status', operationId: 'getStatus', summary: 'Get the gateway overview', response: Overview,
    errors: [500, 502],
  }), async (c) => {
    const snapshot = await deps.cache.get()
    const gateway = gatewayStatus(snapshot, deps.config)
    const integrated = snapshot.environments.filter((environment) => environment.integrated)
    const running = snapshot.containers.filter((container) => container.state === 'running')
    // Shares are on the Overview so they are visible without being looked
    // for: an exposure nobody remembers is the failure mode worth catching.
    const shares = listShares(deps.config, snapshot)

    const counts: OverviewCounts = {
      projects: snapshot.environments.length,
      integratedProjects: integrated.length,
      services: integrated.reduce((total, project) => total + project.serviceCount, 0),
      servicesRunning: integrated.reduce((total, project) => total + project.runningCount, 0),
      servicesHealthy: integrated.reduce((total, project) => total + project.healthyCount, 0),
      servicesUnhealthy: integrated.reduce((total, project) => total + project.unhealthyCount, 0),
      containersTotal: snapshot.containers.length,
      containersRunning: running.length,
      containersGateway: running.filter((container) => container.ownership === 'gateway').length,
      containersIntegrated: running.filter((container) => container.ownership === 'integrated').length,
      containersExternal: running.filter((container) => container.ownership === 'external').length,
      containersStandalone: running.filter((container) => container.ownership === 'standalone').length,
      bridges: listBridges(snapshot).filter((bridge) => bridge.state === 'running').length,
      forwarders: listForwarders(snapshot).filter((forwarder) => forwarder.state === 'running').length,
      routes: gateway.routes,
      shares: shares.filter((share) => share.state === 'active').length,
      sharesStale: shares.filter((share) => share.state !== 'active').length,
    }

    const overview: Overview = {
      gateway,
      counts,
      urls: snapshot.containers
        .filter((container) => container.ownership !== 'gateway' && container.state === 'running')
        .flatMap((container) => container.urls),
      problems: problemsOnly(
        diagnose(
          snapshot,
          deps.config,
          null,
          shares,
          deps.db?.status() ??
            unavailableDatabaseStatus(deps.config.databaseUrl !== null, 'PostgreSQL was unavailable at startup'),
          loadAliases(deps.config),
          githubStatusOf(deps),
        ),
      ),
      generatedAt: snapshot.at,
      github: githubStatusOf(deps),
    }
    return c.json(overview)
  })

  return app
}
