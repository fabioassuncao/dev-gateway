import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { api } from '../lib/api.ts'
import { bytes, relativeTime, uptime } from '../lib/format.ts'
import { Badge } from './ui/badge.tsx'
import { Card, CardBody, CardHeader } from './ui/card.tsx'
import { percentLabel, resourceTone } from './host-resources-lib.ts'
import { Sparkline } from './sparkline.tsx'
import { EnvironmentConsumption } from './environment-consumption.tsx'
import type { HostMetrics, MetricsCurrent, MetricsHistory } from '../../shared/types.ts'

function Bar({ ratio, kind }: { ratio: number | null; kind: 'cpu' | 'memory' | 'storage' }) {
  if (ratio === null) return null
  const width = `${Math.min(100, Math.max(0, ratio * 100))}%`
  const tone = resourceTone(ratio, kind)
  return (
    <div className="h-1.5 w-full overflow-hidden rounded bg-surface-2" aria-hidden>
      <div className={tone === 'warn' ? 'h-full bg-warn' : 'h-full bg-ok'} style={{ width }} />
    </div>
  )
}

function Gauge({
  label,
  value,
  ratio,
  kind,
  spark,
}: {
  label: string
  value: string
  ratio: number | null
  kind: 'cpu' | 'memory' | 'storage'
  spark: Array<number | null>
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-subtle">{label}</span>
        <span className="text-sm font-medium text-ink">{value}</span>
      </div>
      <Bar ratio={ratio} kind={kind} />
      <Sparkline values={spark} />
    </div>
  )
}

function identityLine(host: HostMetrics): string {
  return [host.model, host.distro ?? host.platform, host.cpu.brand, host.architecture]
    .filter((value): value is string => Boolean(value))
    .join(' · ')
}

function runtimeLabel(
  name: MetricsCurrent['runtime'] extends infer T ? T extends { name: infer N } ? N : never : never,
  t: TFunction<'overview', 'host'>,
): string {
  return t(`runtime.${name}`)
}

export function HostResources() {
  const { t, i18n } = useTranslation('overview', { keyPrefix: 'host' })
  const current = useQuery({
    queryKey: ['metrics-current'],
    queryFn: api.metricsCurrent,
    refetchInterval: 5_000,
  })
  const history = useQuery({
    queryKey: ['metrics-history'],
    queryFn: () => api.metricsHistory('30m'),
    refetchInterval: 15_000,
  })
  const data = current.data
  if (current.isPending && !data) return null
  if (!data) return null

  return (
    <>
      <HostResourcesCard data={data} history={history.data} locale={i18n.language} t={t} />
      <EnvironmentConsumption projects={data.projects} />
    </>
  )
}

export function HostResourcesCard({
  data,
  history,
  locale,
  t,
}: {
  data: MetricsCurrent
  history?: MetricsHistory
  locale: string
  t: TFunction<'overview', 'host'>
}) {
  const host = data.host
  const cpuSpark = history?.points.map((point) => point.host.cpuUtilisation) ?? []
  const memSpark = history?.points.map((point) => point.host.memoryUsedPercent) ?? []
  const diskSpark = history?.points.map((point) => point.host.storageUsedPercent) ?? []

  const age = data.ageSeconds
  const status = !data.collectorActive
    ? <Badge tone="warn">{t('collectorInactive')}</Badge>
    : data.stale && age !== null
      ? <Badge tone="warn">{t('stale', { age })}</Badge>
      : data.collectedAt
        ? <Badge>{t('updated', { time: relativeTime(data.collectedAt) })}</Badge>
        : null

  return (
    <Card className="mt-4">
      <CardHeader
        title={t('title')}
        description={host ? identityLine(host) || t('description') : t('unavailable')}
        actions={status}
      />
      <CardBody className="space-y-4">
        {!host ? (
          <p className="text-xs text-subtle">{t('unavailableHint')}</p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Gauge
                label={t('cpu')}
                value={percentLabel(host.cpuUtilisation) ?? t('unavailable')}
                ratio={host.cpuUtilisation}
                kind="cpu"
                spark={cpuSpark}
              />
              <Gauge
                label={t('memory')}
                value={host.memoryTotalBytes !== null
                  ? `${bytes(host.memoryUsedBytes, locale)} / ${bytes(host.memoryTotalBytes, locale)}`
                  : t('unavailable')}
                ratio={host.memoryUsedPercent}
                kind="memory"
                spark={memSpark}
              />
              <Gauge
                label={t('storage.label')}
                value={host.storage
                  ? `${bytes(host.storage.usedBytes, locale)} / ${bytes(host.storage.totalBytes, locale)}`
                  : t('unavailable')}
                ratio={host.storage?.usedPercent ?? null}
                kind="storage"
                spark={diskSpark}
              />
            </div>

            <div className="grid gap-2 text-xs text-muted sm:grid-cols-2">
              <Detail label={t('cpu')}>
                {[host.cpu.brand, host.cpu.logicalCores !== null ? t('cores', { count: host.cpu.logicalCores }) : null]
                  .filter(Boolean)
                  .join(' · ') || t('unavailable')}
                {host.load ? ` · ${t('load', { one: host.load.one.toFixed(2), five: host.load.five.toFixed(2), fifteen: host.load.fifteen.toFixed(2) })}` : ''}
              </Detail>
              {host.gpu[0] ? (
                <Detail label={t('gpu')}>
                  {[host.gpu[0].model, host.gpu[0].vramBytes ? bytes(host.gpu[0].vramBytes, locale) : null, percentLabel(host.gpu[0].utilisation)]
                    .filter(Boolean)
                    .join(' · ')}
                </Detail>
              ) : null}
              <Detail label={t('system')}>
                {[host.distro ?? host.platform, host.version, host.kernel, host.architecture]
                  .filter(Boolean)
                  .join(' · ')}
                {host.uptimeSeconds !== null ? ` · ${t('up', { time: uptime(host.uptimeSeconds) })}` : ''}
              </Detail>
              {host.storage ? (
                <Detail label={t('storage.path')}>
                  <span className="block truncate font-mono" title={host.storage.path}>{host.storage.path}</span>
                </Detail>
              ) : null}
              {data.runtime ? (
                <Detail label={t('runtime.label')}>{runtimeLabel(data.runtime.name, t)}</Detail>
              ) : null}
              {host.swapTotalBytes !== null ? (
                <Detail label={t('swap')}>
                  {`${bytes(host.swapUsedBytes, locale)} / ${bytes(host.swapTotalBytes, locale)}`}
                </Detail>
              ) : null}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  )
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-subtle">{label}</div>
      <div className="text-ink">{children}</div>
    </div>
  )
}
