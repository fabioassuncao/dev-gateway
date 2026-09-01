import type { ContainerSummary, RouteUrl, UrlScope } from '../../shared/types.ts'
import { uptime, shortImage } from '../lib/format.ts'
import { AddressLine } from './copy.tsx'
import { ContainerActions } from './container-actions.tsx'
import { ServiceIcon } from './service-icon.tsx'
import { Badge } from './ui/badge.tsx'
import { ScopeBadge, StateBadge } from './status.tsx'

const SCOPE_ORDER: Record<UrlScope, number> = { local: 0, vpn: 1, public: 2 }
const SCHEME_ORDER: Record<RouteUrl['scheme'], number> = { https: 0, http: 1 }

/** Stable display order: local HTTPS, local HTTP, then VPN and public. */
export function orderedEndpoints(urls: RouteUrl[]): RouteUrl[] {
  return [...urls].sort(
    (left, right) =>
      SCOPE_ORDER[left.scope] - SCOPE_ORDER[right.scope] ||
      SCHEME_ORDER[left.scheme] - SCHEME_ORDER[right.scheme] ||
      left.url.localeCompare(right.url),
  )
}

export function ServiceEndpoints({ service }: { service: ContainerSummary }) {
  const name = service.service ?? service.name

  if (service.state !== 'running') {
    return (
      <span className="text-xs text-subtle">
        No live endpoint while {name} is {service.state}.
      </span>
    )
  }

  const endpoints = orderedEndpoints(service.urls)
  if (endpoints.length > 0) {
    return (
      <div className="min-w-0 space-y-1">
        {endpoints.map((endpoint) => (
          <div key={endpoint.url} className="flex min-w-0 items-center gap-1.5">
            {endpoints.length > 1 ? <ScopeBadge scope={endpoint.scope} /> : null}
            <AddressLine className="min-w-0 flex-1" value={endpoint.url} href={endpoint.url} />
          </div>
        ))}
      </div>
    )
  }

  if (service.kind !== 'http') {
    if (service.exposedPorts.length === 0) {
      return (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-subtle">
          <Badge tone="neutral">{service.kind}</Badge>
          <span>No exposed TCP port; this service is not available through Access.</span>
        </div>
      )
    }
    return (
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
        <Badge tone="neutral">{service.kind}</Badge>
        <span>TCP service · reachable through the</span>
        <a className="font-medium text-accent hover:underline" href="#/access">
          Access page
        </a>
      </div>
    )
  }

  if (!service.traefikEnabled) {
    return <span className="text-xs text-subtle">HTTP service · not routed through the gateway.</span>
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-warn">
      <Badge tone="warn">routing problem</Badge>
      <span>Traefik is enabled, but no endpoint was discovered.</span>
    </div>
  )
}

export function ServiceRow({
  service,
  onShowDetails,
}: {
  service: ContainerSummary
  onShowDetails: () => void
}) {
  const name = service.service ?? service.name
  const ports = service.exposedPorts.length > 0 ? service.exposedPorts.join(', ') : 'none exposed'
  const metadata = [
    service.kind,
    shortImage(service.image),
    `ports ${ports}`,
    service.uptimeSeconds === null ? 'no current uptime' : `up ${uptime(service.uptimeSeconds)}`,
    service.name,
  ].join(' · ')

  return (
    <div
      role="group"
      aria-label={`${name} service`}
      className="grid min-w-0 gap-2 border-b border-line px-4 py-2 last:border-b-0 lg:grid-cols-[minmax(12rem,0.8fr)_minmax(16rem,1.4fr)_auto] lg:items-start"
    >
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button
            className="flex min-w-0 items-center gap-1.5 text-left font-medium text-ink hover:text-accent"
            onClick={onShowDetails}
          >
            <ServiceIcon tech={service.tech} />
            <span className="truncate">{name}</span>
          </button>
          <StateBadge state={service.state} health={service.health} />
        </div>
        <div className="mt-0.5 truncate font-mono text-[11px] text-subtle" title={metadata}>
          {metadata}
        </div>
      </div>

      <div className="min-w-0 lg:pt-0.5">
        <ServiceEndpoints service={service} />
      </div>

      <div className="justify-self-end">
        <ContainerActions container={service} onShowDetails={onShowDetails} />
      </div>
    </div>
  )
}
