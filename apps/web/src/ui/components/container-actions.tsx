import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
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
import { useFormat } from '../lib/use-format.ts'

export function ContainerActions({
  container,
  onShowDetails,
}: {
  container: ContainerSummary
  onShowDetails?: () => void
}) {
  const { t } = useTranslation('gateway', { keyPrefix: 'containerActions' })
  const queryClient = useQueryClient()
  const { shortImage } = useFormat()
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
            {t('error')}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          title={t('logs')}
          aria-label={t('logs')}
          onClick={() => setShowLogs(true)}
        >
          <ScrollText className="h-3.5 w-3.5" />
        </Button>
        <Menu>
          <MenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t('actionsFor', { name: container.name })}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </MenuTrigger>
          <MenuContent>
            {onShowDetails ? (
              <>
                <MenuItem onSelect={onShowDetails}>{t('details')}</MenuItem>
                <MenuSeparator />
              </>
            ) : null}
            <MenuItem disabled={running || isGateway || act.isPending} onSelect={() => act.mutate('start')}>
              <Play className="h-3.5 w-3.5" /> {t('start')}
            </MenuItem>
            <MenuItem disabled={!running || isGateway || act.isPending} onSelect={() => act.mutate('stop')}>
              <Square className="h-3.5 w-3.5" /> {t('stop')}
            </MenuItem>
            <MenuItem disabled={isGateway || act.isPending} onSelect={() => act.mutate('restart')}>
              <RotateCw className="h-3.5 w-3.5" /> {t('restart')}
            </MenuItem>
            <MenuSeparator />
            <MenuItem tone="danger" disabled={isGateway} onSelect={() => setConfirmRemove(true)}>
              <Trash2 className="h-3.5 w-3.5" /> {t('removeContainer')}
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>

      {error ? (
        <div className="fixed right-4 bottom-4 z-50 w-96">
          <ErrorBox error={error} />
        </div>
      ) : null}

      <RemoveDialog container={container} open={confirmRemove} onOpenChange={setConfirmRemove} />

      <Dialog
        open={showLogs}
        onOpenChange={setShowLogs}
        title={t('logsTitle', { name: container.name })}
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

export function RemoveDialog({
  container,
  open,
  onOpenChange,
}: {
  container: ContainerSummary
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('gateway', { keyPrefix: 'containerActions.remove' })
  const { t: tc } = useTranslation('common')
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
      title={t('title')}
      description={t('description')}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{tc('cancel')}</Button>
          <Button
            variant="danger"
            disabled={remove.isPending || preview.data?.allowed === false}
            onClick={() => remove.mutate()}
          >
            {remove.isPending ? t('removing') : t('removeContainer')}
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
              {t('namedVolumes', { count: preview.data.namedVolumes.length })}
            </div>
            <ul className="mt-1 space-y-0.5 font-mono text-xs text-muted">
              {preview.data.namedVolumes.map((volume) => (
                <li key={volume}>{volume}</li>
              ))}
            </ul>
            <p className="mt-1.5 text-xs text-muted">{t('volumesKept')}</p>
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

        {preview.data?.allowed === false ? <Badge tone="danger">{t('notAllowed')}</Badge> : null}

        {error ? <ErrorBox error={error} /> : null}
      </div>
    </Dialog>
  )
}
