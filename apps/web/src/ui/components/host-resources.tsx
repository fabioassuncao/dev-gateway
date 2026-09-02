import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { api } from '../lib/api.ts'
import { bytes, uptime } from '../lib/format.ts'
import { Badge } from './ui/badge.tsx'
import { Card, CardBody, CardHeader } from './ui/card.tsx'
import { percentLabel, resourceTone } from './host-resources-lib.ts'
import type { HostResources as HostResourcesView } from '../../shared/types.ts'

function Bar({ ratio }: { ratio: number | null }) {
  if (ratio === null) return null
  const width = `${Math.min(100, Math.max(0, ratio * 100))}%`
  const tone = resourceTone(ratio)
  return (
    <div className="h-1.5 w-28 overflow-hidden rounded bg-surface-2" aria-hidden>
      <div
        className={tone === 'warn' ? 'h-full bg-warn' : 'h-full bg-ok'}
        style={{ width }}
      />
    </div>
  )
}

function Line({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span className="w-16 shrink-0 text-xs text-subtle">{label}</span>
      <div className="min-w-0 flex-1 text-ink">{children}</div>
    </div>
  )
}

function usage(
  used: number | null,
  total: number | null,
  ratio: number | null,
  locale: string,
) {
  if (total === null) return null
  const parts = [used !== null ? `${bytes(used, locale)} / ${bytes(total, locale)}` : bytes(total, locale)]
  const percent = percentLabel(ratio)
  if (percent) parts.push(percent)
  return parts.join(' · ')
}

export function HostResources() {
  const { t, i18n } = useTranslation('overview', { keyPrefix: 'host' })
  const query = useQuery({ queryKey: ['host-resources'], queryFn: api.hostResources })
  const data = query.data
  if (query.isPending && !data) return null
  if (!data) return null

  return <HostResourcesCard data={data} locale={i18n.language} t={t} />
}

export function HostResourcesCard({
  data,
  locale,
  t,
}: {
  data: HostResourcesView
  locale: string
  t: TFunction<'overview', 'host'>
}) {
  const { system, cpu, memory, storage, gpu } = data
  const memoryTone = resourceTone(memory.usedPercent)
  const systemBits = [system.hostname, system.os, system.osVersion, system.architecture]
    .filter((value): value is string => Boolean(value))

  return (
    <Card className="mt-4">
      <CardHeader
        title={t('title')}
        description={t('description')}
        actions={
          data.stale ? (
            <Badge tone="warn">{t('stale', { age: data.ageSeconds })}</Badge>
          ) : data.collectedAt ? (
            <Badge>{t('fresh')}</Badge>
          ) : null
        }
      />
      <CardBody className="space-y-2">
        {systemBits.length > 0 || system.uptimeSeconds !== null ? (
          <Line label={t('system')}>
            <span className="text-xs">
              {systemBits.join(' · ')}
              {system.kernel ? ` · ${system.kernel}` : ''}
              {system.uptimeSeconds !== null ? ` · ${t('up', { time: uptime(system.uptimeSeconds) })}` : ''}
            </span>
          </Line>
        ) : null}

        {cpu.model || cpu.cores !== null || cpu.utilisation !== null || cpu.load ? (
          <Line label={t('cpu')}>
            <span className="text-xs">
              {[
                cpu.model,
                cpu.cores !== null ? t('cores', { count: cpu.cores }) : null,
                percentLabel(cpu.utilisation),
                cpu.load ? t('load', { one: cpu.load.one.toFixed(2), five: cpu.load.five.toFixed(2), fifteen: cpu.load.fifteen.toFixed(2) }) : null,
              ].filter(Boolean).join(' · ')}
            </span>
          </Line>
        ) : null}

        {memory.totalBytes !== null ? (
          <Line label={t('memory')}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs">{usage(memory.usedBytes, memory.totalBytes, memory.usedPercent, locale)}</span>
              <Bar ratio={memory.usedPercent} />
              {memoryTone === 'warn' ? <Badge tone="warn">{t('high')}</Badge> : null}
            </div>
          </Line>
        ) : null}

        {storage.map((row) => (
          <Line key={`${row.role}:${row.path}`} label={t(`storage.${row.role}`)}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-muted">{row.path}</span>
              <span className="text-xs">{usage(row.usedBytes, row.totalBytes, row.usedPercent, locale)}</span>
              <Bar ratio={row.usedPercent} />
              {resourceTone(row.usedPercent) === 'warn' ? <Badge tone="warn">{t('high')}</Badge> : null}
            </div>
          </Line>
        ))}

        {gpu.map((card) => (
          <Line key={card.name} label={t('gpu')}>
            <span className="text-xs">
              {[
                card.name,
                usage(card.memoryUsedBytes, card.memoryTotalBytes, card.memoryTotalBytes > 0 ? card.memoryUsedBytes / card.memoryTotalBytes : null, locale),
                percentLabel(card.utilisation),
              ].filter(Boolean).join(' · ')}
            </span>
          </Line>
        ))}

        {data.hint ? <p className="text-xs text-subtle">{t('collectHint', { command: data.hint })}</p> : null}
      </CardBody>
    </Card>
  )
}
