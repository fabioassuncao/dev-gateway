import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { ContainerSummary } from '../../shared/types.ts'
import { api } from '../lib/api.ts'
import { Dialog } from './ui/dialog.tsx'
import { KeyValue } from './shell-bits.tsx'
import { OwnershipBadge, ScopeBadge, StateBadge } from './status.tsx'
import { AddressLine, Mono } from './copy.tsx'
import { useFormat } from '../lib/use-format.ts'
import { ServiceIcon } from './service-icon.tsx'
import { TraefikVerdictRow } from './traefik-verdict.tsx'
import { SharePanel } from './share-panel.tsx'

export function ContainerDetails({
  container,
  open,
  onOpenChange,
}: {
  container: ContainerSummary
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t: tc } = useTranslation('common')
  const { shortId, uptime, bytes } = useFormat()
  const stats = useQuery({
    queryKey: ['stats', container.id],
    queryFn: () => api.stats(container.id),
    enabled: open && container.state === 'running',
    staleTime: 10_000,
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span className="flex items-center gap-2">
          <ServiceIcon tech={container.tech} className="text-ink" />
          <span>{container.name}</span>
        </span>
      }
      description={`${container.tech.label} · ${container.image}`}
      className="w-[min(94vw,46rem)]"
    >
      <dl className="divide-y divide-line/60">
        <KeyValue label={tc('container.status')}>
          <div className="flex items-center gap-2">
            <StateBadge state={container.state} health={container.health} />
            <OwnershipBadge ownership={container.ownership} />
          </div>
        </KeyValue>
        <KeyValue label={tc('container.containerId')}>
          <Mono value={shortId(container.id)} />
        </KeyValue>
        {container.project ? (
          <KeyValue label={tc('container.composeProject')}>
            {container.project}
            {container.service ? <span className="text-muted"> · {container.service}</span> : null}
          </KeyValue>
        ) : null}
        {container.workingDir ? (
          <KeyValue label={tc('container.workingDirectory')}>
            <Mono value={container.workingDir} />
          </KeyValue>
        ) : null}
        {container.namespace ? <KeyValue label={tc('container.worktree')}>{container.namespace}</KeyValue> : null}
        <KeyValue label={tc('container.uptime')}>{uptime(container.uptimeSeconds)}</KeyValue>
        {container.restartCount > 0 ? (
          <KeyValue label={tc('container.restarts')}>{container.restartCount}</KeyValue>
        ) : null}
        {container.state !== 'running' && container.exitCode !== null ? (
          <KeyValue label={tc('container.exitCode')}>{container.exitCode}</KeyValue>
        ) : null}
        {stats.data && stats.data.cpuPercent !== null ? (
          <KeyValue label={tc('container.resources')}>
            <span className="tabular-nums">
              {stats.data.cpuPercent}% CPU · {bytes(stats.data.memoryBytes)} memory
            </span>
          </KeyValue>
        ) : null}

        {container.urls.length > 0 ? (
          <KeyValue label={tc('container.urls')}>
            <div className="space-y-1">
              {container.urls.map((url) => (
                <div key={url.url} className="flex items-center gap-2">
                  <ScopeBadge scope={url.scope} />
                  <AddressLine value={url.url} href={url.url} />
                </div>
              ))}
            </div>
          </KeyValue>
        ) : null}

        <KeyValue label={tc('container.networks')}>
          <div className="flex flex-wrap gap-1.5 font-mono text-xs text-muted">
            {container.networks.length ? container.networks.join(', ') : tc('none', { defaultValue: 'none' })}
          </div>
        </KeyValue>

        {container.exposedPorts.length > 0 ? (
          <KeyValue label={tc('container.containerPorts')}>
            <Mono value={container.exposedPorts.join(', ')} />
          </KeyValue>
        ) : null}

        {container.ports.length > 0 ? (
          <KeyValue label={tc('container.publishedPorts')}>
            <div className="space-y-0.5">
              {container.ports.map((port) => (
                <div key={`${port.ip}:${port.hostPort}`} className="font-mono text-xs">
                  {port.ip}:{port.hostPort} → {port.containerPort}/{port.protocol}
                </div>
              ))}
            </div>
          </KeyValue>
        ) : null}

        {container.urls.length > 0 ? (
          <KeyValue label={tc('container.exposure')}>
            <SharePanel container={container} />
          </KeyValue>
        ) : null}

        {container.urls.length > 0 ? (
          <KeyValue label={tc('container.traefik')}>
            <TraefikVerdictRow container={container} enabled={open} />
          </KeyValue>
        ) : null}

        {container.mounts.length > 0 ? (
          <KeyValue label={tc('container.mounts')}>
            <div className="space-y-0.5 font-mono text-xs text-muted">
              {container.mounts.map((mount) => (
                <div key={mount.destination}>
                  {mount.type}: {mount.name ?? mount.source} → {mount.destination}
                  {mount.rw ? '' : ' (ro)'}
                </div>
              ))}
            </div>
          </KeyValue>
        ) : null}

        {Object.keys(container.labels).length > 0 ? (
          <KeyValue label={tc('container.labels')}>
            <div className="max-h-48 space-y-0.5 overflow-y-auto font-mono text-[11px] text-muted scroll-thin">
              {Object.entries(container.labels).map(([key, value]) => (
                <div key={key} className="break-all">
                  <span className="text-subtle">{key}</span>={value}
                </div>
              ))}
            </div>
          </KeyValue>
        ) : null}
      </dl>
    </Dialog>
  )
}
