// The gateway's own state, read from the containers it labels as its own.

import type { PanelConfig } from '../config.ts'
import { schemeFor } from '../config.ts'
import type { Snapshot } from './inventory.ts'
import type { ContainerSummary, GatewayStatus, Health, ContainerState } from '../../shared/types.ts'

export function componentOf(snapshot: Snapshot, component: string): ContainerSummary | null {
  return (
    snapshot.containers.find(
      (container) => container.ownership === 'gateway' && container.gatewayComponent === component,
    ) ?? null
  )
}

export function gatewayStatus(snapshot: Snapshot, config: PanelConfig): GatewayStatus {
  const traefik = componentOf(snapshot, 'traefik')
  const socketProxy = componentOf(snapshot, 'socket-proxy')
  const tailscale = componentOf(snapshot, 'tailscale')
  const network = snapshot.networks.find((item) => item.name === config.network) ?? null
  const routes = snapshot.containers.filter(
    (container) => container.ownership !== 'gateway' && container.urls.length > 0,
  ).length

  return {
    gatewayVersion: config.gatewayVersion,
    panelVersion: config.panelVersion,
    profile: config.profile,
    domain: config.domain,
    privateDomain: config.privateDomain,
    publicDomain: config.publicDomain,
    bindAddress: config.bindAddress,
    httpPort: config.httpPort,
    httpsPort: config.httpsPort,
    scheme: schemeFor(config),
    up: traefik?.state === 'running',
    reachable: snapshot.reachable,
    tls: { enabled: config.tlsEnabled, mode: config.tlsMode },
    tailscale: {
      enabled: config.tailscaleEnabled,
      running: tailscale?.state === 'running',
      hostname: config.tailscaleHostname,
    },
    publicAccess: { enabled: config.publicEnabled, domain: config.publicDomain },
    dashboard: {
      enabled: config.dashboardEnabled,
      bindAddress: config.dashboardBindAddress,
      port: config.dashboardPort,
    },
    traefik: {
      containerId: traefik?.id ?? null,
      state: (traefik?.state ?? 'absent') as ContainerState | 'absent',
      health: (traefik?.health ?? 'none') as Health,
    },
    socketProxy: {
      containerId: socketProxy?.id ?? null,
      state: (socketProxy?.state ?? 'absent') as ContainerState | 'absent',
    },
    network: {
      name: config.network,
      exists: network !== null,
      attached: network?.containerCount ?? 0,
      internal: network?.internal ?? false,
    },
    routes,
  }
}

/** Gateway components the panel is allowed to restart. */
export const RESTARTABLE_COMPONENTS = ['traefik', 'socket-proxy', 'tailscale'] as const
