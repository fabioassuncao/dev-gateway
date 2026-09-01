import { useQuery } from '@tanstack/react-query'
import type { ContainerSummary } from '../../shared/types.ts'
import { api } from '../lib/api.ts'
import { Dialog } from './ui/dialog.tsx'
import { KeyValue } from './shell-bits.tsx'
import { OwnershipBadge, ScopeBadge, StateBadge } from './status.tsx'
import { AddressLine, Mono } from './copy.tsx'
import { bytes, shortId, uptime } from '../lib/format.ts'

export function ContainerDetails({
  container,
  open,
  onOpenChange,
}: {
  container: ContainerSummary
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
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
      title={container.name}
      description={container.image}
      className="w-[min(94vw,46rem)]"
    >
      <dl className="divide-y divide-line/60">
        <KeyValue label="Status">
          <div className="flex items-center gap-2">
            <StateBadge state={container.state} health={container.health} />
            <OwnershipBadge ownership={container.ownership} />
          </div>
        </KeyValue>
        <KeyValue label="Container id">
          <Mono value={shortId(container.id)} />
        </KeyValue>
        {container.project ? (
          <KeyValue label="Compose project">
            {container.project}
            {container.service ? <span className="text-muted"> · {container.service}</span> : null}
          </KeyValue>
        ) : null}
        {container.workingDir ? (
          <KeyValue label="Working directory">
            <Mono value={container.workingDir} />
          </KeyValue>
        ) : null}
        {container.namespace ? <KeyValue label="Worktree">{container.namespace}</KeyValue> : null}
        <KeyValue label="Uptime">{uptime(container.uptimeSeconds)}</KeyValue>
        {container.restartCount > 0 ? (
          <KeyValue label="Restarts">{container.restartCount}</KeyValue>
        ) : null}
        {container.state !== 'running' && container.exitCode !== null ? (
          <KeyValue label="Exit code">{container.exitCode}</KeyValue>
        ) : null}
        {stats.data && stats.data.cpuPercent !== null ? (
          <KeyValue label="Resources">
            <span className="tabular-nums">
              {stats.data.cpuPercent}% CPU · {bytes(stats.data.memoryBytes)} memory
            </span>
          </KeyValue>
        ) : null}

        {container.urls.length > 0 ? (
          <KeyValue label="URLs">
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

        <KeyValue label="Networks">
          <div className="flex flex-wrap gap-1.5 font-mono text-xs text-muted">
            {container.networks.length ? container.networks.join(', ') : 'none'}
          </div>
        </KeyValue>

        {container.exposedPorts.length > 0 ? (
          <KeyValue label="Container ports">
            <Mono value={container.exposedPorts.join(', ')} />
          </KeyValue>
        ) : null}

        {container.ports.length > 0 ? (
          <KeyValue label="Published ports">
            <div className="space-y-0.5">
              {container.ports.map((port) => (
                <div key={`${port.ip}:${port.hostPort}`} className="font-mono text-xs">
                  {port.ip}:{port.hostPort} → {port.containerPort}/{port.protocol}
                </div>
              ))}
            </div>
          </KeyValue>
        ) : null}

        {container.mounts.length > 0 ? (
          <KeyValue label="Mounts">
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
          <KeyValue label="Labels">
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
