import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { api } from '../lib/api.ts'
import { Badge } from './ui/badge.tsx'
import type { ContainerSummary } from '../../shared/types.ts'

/**
 * What Traefik says about this service, next to what its labels say.
 *
 * The panel derives hostnames from labels and is right about them, which is
 * exactly why this exists: when a hostname 404s and the labels look correct,
 * only Traefik knows why. The dashboard link hands the user to the tool that
 * owns the answer rather than rebuilding it here.
 */
export function TraefikVerdictRow({
  container,
  enabled,
}: {
  container: ContainerSummary
  enabled: boolean
}) {
  const query = useQuery({
    queryKey: ['service-traefik', container.id],
    queryFn: () => api.serviceTraefik(container.id),
    enabled,
    staleTime: 7_000,
  })

  if (query.isPending) return <span className="text-xs text-subtle">asking Traefik…</span>
  if (query.error || !query.data) {
    return <span className="text-xs text-subtle">Traefik could not be asked.</span>
  }

  const data = query.data

  // Not "no problem": not asked. Saying so is the whole point.
  if (!data.available) {
    return (
      <div className="space-y-1 text-xs text-subtle">
        <div>{data.reason}</div>
        <div>The addresses above come from the labels, which is what they have always been.</div>
      </div>
    )
  }

  if (data.routers.length === 0) {
    return (
      <div className="space-y-1 text-xs">
        <Badge tone="danger">no router</Badge>
        <div className="text-subtle">
          Traefik built no router for {data.expectedHosts.join(', ')}. The labels are read from
          Docker, so the usual cause is the container not being on the shared network.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2 text-xs">
      {data.routers.map((router) => (
        <div key={router.name} className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-ink">{router.name}</span>
            {router.status === 'enabled' ? (
              <Badge tone="ok">{router.status}</Badge>
            ) : (
              <Badge tone="danger">{router.status}</Badge>
            )}
            {router.entryPoints.map((entry) => (
              <Badge key={entry} tone="outline">
                {entry}
              </Badge>
            ))}
            {router.dashboardUrl ? (
              <a
                className="inline-flex items-center gap-1 text-muted underline-offset-2 hover:text-accent hover:underline"
                href={router.dashboardUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                dashboard
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </div>

          <div className="font-mono text-[11px] break-all text-subtle">{router.rule}</div>

          {router.middlewares.length > 0 ? (
            <div className="text-subtle">middlewares: {router.middlewares.join(', ')}</div>
          ) : null}

          {router.servers.length > 0 ? (
            <div className="font-mono text-[11px] text-subtle">→ {router.servers.join(', ')}</div>
          ) : null}

          {router.errors.length > 0 ? (
            <div className="text-danger">{router.errors.join('; ')}</div>
          ) : null}
        </div>
      ))}
    </div>
  )
}
