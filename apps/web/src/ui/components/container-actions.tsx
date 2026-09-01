import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal, Play, RotateCw, ScrollText, Square, Trash2 } from 'lucide-react'
import type { ContainerSummary } from '../../shared/types.ts'
import { api } from '../lib/api.ts'
import { Button } from './ui/button.tsx'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from './ui/menu.tsx'
import { Dialog } from './ui/dialog.tsx'
import { ErrorBox } from './shell-bits.tsx'
import { Badge } from './ui/badge.tsx'
import { OwnershipBadge } from './status.tsx'
import { LogViewer } from './logs.tsx'
import { shortImage } from '../lib/format.ts'

export function ContainerActions({
  container,
  onShowDetails,
}: {
  container: ContainerSummary
  onShowDetails?: () => void
}) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<unknown>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [showLogs, setShowLogs] = useState(false)

  const act = useMutation({
    mutationFn: (action: 'start' | 'stop' | 'restart') => api.containerAction(container.id, action),
    onSuccess: () => void queryClient.invalidateQueries(),
    onError: setError,
  })

  const isGateway = container.ownership === 'gateway'
  const running = container.state === 'running'

  return (
    <>
      <div className="flex items-center justify-end gap-1">
        {error ? (
          <Button variant="ghost" size="sm" onClick={() => setError(null)} className="text-danger">
            error
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          title="Logs"
          aria-label="Logs"
          onClick={() => setShowLogs(true)}
        >
          <ScrollText className="h-3.5 w-3.5" />
        </Button>
        <Menu>
          <MenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Actions for ${container.name}`}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </MenuTrigger>
          <MenuContent>
            {onShowDetails ? (
              <>
                <MenuItem onSelect={onShowDetails}>Details</MenuItem>
                <MenuSeparator />
              </>
            ) : null}
            <MenuItem disabled={running || isGateway || act.isPending} onSelect={() => act.mutate('start')}>
              <Play className="h-3.5 w-3.5" /> Start
            </MenuItem>
            <MenuItem disabled={!running || isGateway || act.isPending} onSelect={() => act.mutate('stop')}>
              <Square className="h-3.5 w-3.5" /> Stop
            </MenuItem>
            <MenuItem disabled={isGateway || act.isPending} onSelect={() => act.mutate('restart')}>
              <RotateCw className="h-3.5 w-3.5" /> Restart
            </MenuItem>
            <MenuSeparator />
            <MenuItem tone="danger" disabled={isGateway} onSelect={() => setConfirmRemove(true)}>
              <Trash2 className="h-3.5 w-3.5" /> Remove container
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>

      {error ? (
        <div className="fixed right-4 bottom-4 z-50 w-96">
          <ErrorBox error={error} />
        </div>
      ) : null}

      <RemoveDialog
        container={container}
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
      />

      <Dialog
        open={showLogs}
        onOpenChange={setShowLogs}
        title={`Logs · ${container.name}`}
        description={shortImage(container.image)}
        className="w-[min(94vw,60rem)]"
      >
        <div className="h-[55vh] min-h-0">
          <LogViewer
            queryKey={['logs', container.id]}
            load={(tail) => api.logs(container.id, tail)}
            className="h-full rounded-md border border-line"
          />
        </div>
      </Dialog>
    </>
  )
}

/**
 * Removal is the only destructive action the panel offers, so it says exactly
 * what goes and what stays before it happens.
 */
export function RemoveDialog({
  container,
  open,
  onOpenChange,
}: {
  container: ContainerSummary
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<unknown>(null)

  const preview = useQuery({
    queryKey: ['removal-preview', container.id],
    queryFn: () => api.removalPreview(container.id),
    enabled: open,
  })

  const remove = useMutation({
    mutationFn: () => api.removeContainer(container.id, container.state === 'running'),
    onSuccess: () => {
      onOpenChange(false)
      void queryClient.invalidateQueries()
    },
    onError: setError,
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Remove this container?"
      description="The container goes. Volumes, networks and images stay exactly where they are."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="danger"
            disabled={remove.isPending || preview.data?.allowed === false}
            onClick={() => remove.mutate()}
          >
            {remove.isPending ? 'Removing…' : 'Remove container'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="rounded-md border border-line bg-surface-2/60 p-3">
          <div className="flex items-center gap-2">
            <span className="font-medium text-ink">{container.name}</span>
            <OwnershipBadge ownership={container.ownership} />
          </div>
          <div className="mt-1 font-mono text-xs text-muted">{container.image}</div>
        </div>

        {preview.data?.namedVolumes.length ? (
          <div className="rounded-md border border-warn/40 bg-warn/5 p-3">
            <div className="text-xs font-medium text-warn">
              This container has {preview.data.namedVolumes.length} named volume(s)
            </div>
            <ul className="mt-1 space-y-0.5 font-mono text-xs text-muted">
              {preview.data.namedVolumes.map((volume) => (
                <li key={volume}>{volume}</li>
              ))}
            </ul>
            <p className="mt-1.5 text-xs text-muted">
              They are kept. The panel never removes a volume, and never runs a prune.
            </p>
          </div>
        ) : null}

        {preview.data?.warnings.length ? (
          <ul className="space-y-1 text-xs text-muted">
            {preview.data.warnings.map((warning) => (
              <li key={warning} className="flex gap-2">
                <span className="text-subtle">·</span>
                {warning}
              </li>
            ))}
          </ul>
        ) : null}

        {preview.data?.allowed === false ? (
          <Badge tone="danger">The panel does not remove its own infrastructure</Badge>
        ) : null}

        {error ? <ErrorBox error={error} /> : null}
      </div>
    </Dialog>
  )
}
