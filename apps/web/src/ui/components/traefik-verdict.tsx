import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ExternalLink } from 'lucide-react'
import { api } from '../lib/api.ts'
import { Badge } from './ui/badge.tsx'
import type { ContainerSummary } from '../../shared/types.ts'

export function TraefikVerdictRow({
  container,
  enabled,
}: {
  container: ContainerSummary
  enabled: boolean
}) {
  const { t } = useTranslation('common', { keyPrefix: 'traefikVerdict' })
  const query = useQuery({
    queryKey: ['service-traefik', container.id],
    queryFn: () => api.serviceTraefik(container.id),
    enabled,
    staleTime: 7_000,
  })

  if (query.isPending) {
    return <span className="text-xs text-subtle">{t('asking', { defaultValue: 'asking Traefik…' })}</span>
  }
  if (query.error || !query.data) {
    return <span className="text-xs text-subtle">{t('couldNotAsk', { defaultValue: 'Traefik could not be asked.' })}</span>
  }

  const data = query.data

  if (!data.available) {
    return (
      <div className="space-y-1 text-xs text-subtle">
        <div>{data.reason}</div>
        <div>{t('labelsFallback', { defaultValue: 'The addresses above come from the labels, which is what they have always been.' })}</div>
      </div>
    )
  }

  if (data.routers.length === 0) {
    return (
      <div className="space-y-1 text-xs">
        <Badge tone="danger">{t('noRouter', { defaultValue: 'no router' })}</Badge>
        <div className="text-subtle">
          {t('noRouterDetail', {
            defaultValue:
              'Traefik built no router for {{hosts}}. The labels are read from Docker, so the usual cause is the container not being on the shared network.',
            hosts: data.expectedHosts.join(', '),
          })}
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
                {t('dashboard', { defaultValue: 'dashboard' })}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </div>

          <div className="font-mono text-[11px] break-all text-subtle">{router.rule}</div>

          {router.middlewares.length > 0 ? (
            <div className="text-subtle">
              {t('middlewares', { defaultValue: 'middlewares:' })} {router.middlewares.join(', ')}
            </div>
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
