import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Hammer, Trash2 } from 'lucide-react'
import type {
  Project,
  ProjectRemovalPreview,
  ProjectRemoveResult,
  RunnerStatus,
} from '../../shared/types.ts'
import { api } from '../lib/api.ts'
import { Button } from './ui/button.tsx'
import { Dialog } from './ui/dialog.tsx'
import { ErrorBox } from './shell-bits.tsx'
import { CopyButton } from './copy.tsx'

type RemoveMode = 'keep-data' | 'and-local-data'

export function ProjectOperations({ project }: { project: Project }) {
  const { t } = useTranslation('projects', { keyPrefix: 'operations' })
  const [rebuildOpen, setRebuildOpen] = useState(false)
  const [removeMode, setRemoveMode] = useState<RemoveMode | null>(null)

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Button
        size="sm"
        disabled={!project.operable.ok}
        title={project.operable.ok ? t('rebuild') : (project.operable.reason ?? t('rebuildDisabled'))}
        onClick={() => setRebuildOpen(true)}
      >
        <Hammer className="h-3.5 w-3.5" />
        {t('rebuild')}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        title={t('removeKeep')}
        onClick={() => setRemoveMode('keep-data')}
      >
        <Trash2 className="h-3.5 w-3.5" />
        {t('removeKeep')}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        title={t('removeData')}
        onClick={() => setRemoveMode('and-local-data')}
      >
        {t('removeData')}
      </Button>

      {rebuildOpen ? (
        <RebuildDialog project={project} onClose={() => setRebuildOpen(false)} />
      ) : null}
      {removeMode ? (
        <RemoveDialog project={project} mode={removeMode} onClose={() => setRemoveMode(null)} />
      ) : null}
    </div>
  )
}

function RebuildDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const { t } = useTranslation('projects', { keyPrefix: 'operations' })
  const { t: tc } = useTranslation('common')
  const queryClient = useQueryClient()
  const [noCache, setNoCache] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [started, setStarted] = useState(false)

  const rebuild = useMutation({
    mutationFn: () => api.rebuildProject(project.name, { noCache }),
    onSuccess: () => {
      setStarted(true)
      void queryClient.invalidateQueries()
    },
    onError: setError,
  })

  const runner = useQuery({
    queryKey: ['runner', 'rebuild', project.name],
    queryFn: ({ signal }) => api.runnerProbe(signal, true),
    enabled: started,
    refetchInterval: (query) => (query.state.data?.state === 'running' ? 1500 : false),
  })

  const status = runner.data
  const running = started && (status?.state === 'running' || status?.state === 'idle' && rebuild.isSuccess && !status?.exitCode)
  const done = status?.state === 'ok' || status?.state === 'failed'

  return (
    <Dialog
      open
      dismissible={!rebuild.isPending && !running}
      onOpenChange={(next) => { if (!next) onClose() }}
      title={t('rebuildTitle')}
      description={t('rebuildDescription', { name: project.name })}
      footer={
        done ? (
          <Button variant="primary" onClick={onClose}>{tc('close')}</Button>
        ) : started ? null : (
          <>
            <Button variant="ghost" onClick={onClose}>{tc('cancel')}</Button>
            <Button variant="primary" disabled={rebuild.isPending} onClick={() => rebuild.mutate()}>
              {t('rebuild')}
            </Button>
          </>
        )
      }
    >
      {error ? <ErrorBox error={error} /> : null}
      {!started ? (
        <label className="mt-2 flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="mt-1"
            checked={noCache}
            onChange={(event) => setNoCache(event.target.checked)}
          />
          <span>
            {t('noCache')}
            <span className="mt-1 block text-xs text-muted">{t('noCacheCost')}</span>
          </span>
        </label>
      ) : (
        <RunnerLog status={status ?? null} failed={status?.state === 'failed'} />
      )}
    </Dialog>
  )
}

function RemoveDialog({
  project,
  mode,
  onClose,
}: {
  project: Project
  mode: RemoveMode
  onClose: () => void
}) {
  const { t } = useTranslation('projects', { keyPrefix: 'operations' })
  const { t: tc } = useTranslation('common')
  const queryClient = useQueryClient()
  const [confirmation, setConfirmation] = useState('')
  const [directory, setDirectory] = useState(false)
  const [overrideDirty, setOverrideDirty] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [result, setResult] = useState<ProjectRemoveResult | null>(null)

  const preview = useQuery({
    queryKey: ['project-removal-preview', project.name],
    queryFn: () => api.projectRemovalPreview(project.name),
  })

  const remove = useMutation({
    mutationFn: () =>
      api.removeProject(project.name, {
        confirmation,
        volumes: mode === 'and-local-data',
        directory: mode === 'and-local-data' && directory,
        overrideDirty: overrideDirty || undefined,
      }),
    onSuccess: (body) => {
      setResult(body)
      void queryClient.invalidateQueries()
    },
    onError: setError,
  })

  const canSubmit = confirmation === project.name && !remove.isPending
  const data = preview.data

  return (
    <Dialog
      open
      onOpenChange={(next) => { if (!next) onClose() }}
      title={mode === 'keep-data' ? t('removeKeepTitle') : t('removeDataTitle')}
      description={t('removeFromHost', { name: project.name })}
      footer={
        result ? (
          <Button variant="primary" onClick={onClose}>{tc('close')}</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>{tc('cancel')}</Button>
            <Button variant="danger" disabled={!canSubmit} onClick={() => remove.mutate()}>
              {mode === 'keep-data' ? t('removeKeep') : t('removeData')}
            </Button>
          </>
        )
      }
    >
      <p className="text-sm text-ink">{t('githubUntouched')}</p>
      {preview.error ? <ErrorBox error={preview.error} /> : null}
      {error ? <ErrorBox error={error} /> : null}

      {data && !result ? <PreviewBody preview={data} /> : null}

      {result ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-ink">{result.note}</p>
          {result.remainingCommands.length > 0 ? (
            <ul className="space-y-1">
              {result.remainingCommands.map((command) => (
                <li key={command} className="flex items-center gap-2 rounded border border-line bg-surface-2 px-2 py-1.5">
                  <code className="min-w-0 flex-1 truncate font-mono text-xs">{command}</code>
                  <CopyButton value={command} label={t('copyCommand')} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <>
          {mode === 'and-local-data' && data?.directoryRemovalAvailable ? (
            <label className="mt-3 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={directory}
                onChange={(event) => setDirectory(event.target.checked)}
              />
              <span>{t('alsoDirectory')}</span>
            </label>
          ) : null}
          {mode === 'and-local-data' && !data?.directoryRemovalAvailable ? (
            <p className="mt-2 text-xs text-muted">{t('directoryNeedsRunner')}</p>
          ) : null}
          {directory && data?.git.dirty ? (
            <label className="mt-2 flex items-start gap-2 text-sm text-warn">
              <input
                type="checkbox"
                className="mt-1"
                checked={overrideDirty}
                onChange={(event) => setOverrideDirty(event.target.checked)}
              />
              <span>
                {t('dirtyOverride', {
                  staged: data.git.staged,
                  unstaged: data.git.unstaged,
                  untracked: data.git.untracked,
                })}
              </span>
            </label>
          ) : null}
          <label className="mt-3 block text-sm">
            <span className="text-muted">{t('typeName', { name: project.name })}</span>
            <input
              className="mt-1 w-full rounded border border-line bg-surface-2 px-2 py-1.5 font-mono text-sm"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        </>
      )}
    </Dialog>
  )
}

function PreviewBody({ preview }: { preview: ProjectRemovalPreview }) {
  const { t } = useTranslation('projects', { keyPrefix: 'operations' })
  return (
    <div className="mt-3 space-y-2 text-sm">
      <p className="text-muted">{t('previewContainers', { count: preview.containers.length })}</p>
      <ul className="list-inside list-disc text-ink">
        {preview.containers.map((container) => (
          <li key={container.id}>{container.service ?? container.name}</li>
        ))}
      </ul>
      {preview.volumes.length > 0 ? (
        <p className="text-muted">
          {t('previewVolumes', { names: preview.volumes.map((volume) => volume.name).join(', ') })}
        </p>
      ) : null}
      {preview.workingDir ? (
        <p className="font-mono text-xs text-muted">{preview.workingDir}</p>
      ) : null}
    </div>
  )
}

function RunnerLog({ status, failed }: { status: RunnerStatus | null; failed: boolean }) {
  const { t } = useTranslation('projects', { keyPrefix: 'operations' })
  if (!status) return <p className="text-sm text-muted">{t('rebuildStarting')}</p>
  return (
    <div className="mt-2">
      <p className={`text-sm ${failed ? 'text-danger' : 'text-ink'}`}>
        {failed ? t('rebuildFailed') : status.state === 'ok' ? t('rebuildOk') : t('rebuildRunning')}
      </p>
      {status.logTail.length > 0 ? (
        <pre className="mt-2 max-h-56 overflow-auto rounded border border-line bg-surface-2 p-2 font-mono text-xs">
          {status.logTail.join('\n')}
        </pre>
      ) : null}
    </div>
  )
}
