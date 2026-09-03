import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { EyeOff, Play, RotateCw, Square } from 'lucide-react'
import type { Environment, EnvironmentActionResult, EnvironmentRunnerStartResult } from '../../shared/types.ts'
import { api } from '../lib/api/index.ts'
import { Button } from './ui/button.tsx'
import { Dialog } from './ui/dialog.tsx'
import { ErrorBox } from './shell-bits.tsx'
import { CopyButton } from './copy.tsx'

type ActionSummary = EnvironmentActionResult | EnvironmentRunnerStartResult

/** A runner start carries no per-service results: the containers do not exist yet. */
function viaRunner(summary: ActionSummary): summary is EnvironmentRunnerStartResult {
  return 'via' in summary && summary.via === 'runner'
}

/**
 * Start, Stop and Restart for a live environment. A remembered one (its
 * containers are gone) can only be started, through the runner, or forgotten;
 * without the runner the panel shows the Compose command to run on the host.
 */
export function EnvironmentActions({ project, onForgotten }: {
  project: Environment
  /** Called after a remembered environment was forgotten; the page uses it to leave. */
  onForgotten?: () => void
}) {
  const { t } = useTranslation('environments', { keyPrefix: 'actions' })
  const queryClient = useQueryClient()
  const [error, setError] = useState<unknown>(null)
  const [confirmStop, setConfirmStop] = useState(false)
  const [confirmForget, setConfirmForget] = useState(false)
  const [summary, setSummary] = useState<ActionSummary | null>(null)
  const remembered = project.presence === 'remembered'

  const act = useMutation({
    mutationFn: (action: 'start' | 'stop' | 'restart') => api.environmentAction(project.name, action),
    onSuccess: (result) => {
      setSummary(result)
      setConfirmStop(false)
      void queryClient.invalidateQueries()
    },
    onError: setError,
  })

  const forget = useMutation({
    mutationFn: () => api.forgetEnvironment(project.name),
    onSuccess: () => {
      setConfirmForget(false)
      void queryClient.invalidateQueries()
      onForgotten?.()
    },
    onError: setError,
  })

  const canStart = project.startable.ok
  const canStop = project.runningCount > 0
  const canRestart = project.serviceCount > 0
  const services = project.services.map((service) => service.service ?? service.name)
  // For a remembered environment the reason is the Compose command the operator can run by hand.
  const startCommand = remembered && !canStart ? project.startable.reason : null

  return (
    <>
      <div className="flex flex-wrap items-center gap-1">
        <Button
          size="sm"
          disabled={!canStart || act.isPending}
          title={canStart ? t('start') : (project.startable.reason ?? t('startDisabled'))}
          onClick={() => act.mutate('start')}
        >
          <Play className="h-3.5 w-3.5" />
          {t('start')}
        </Button>
        {remembered ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={forget.isPending}
            title={t('forget')}
            onClick={() => setConfirmForget(true)}
          >
            <EyeOff className="h-3.5 w-3.5" />
            {t('forget')}
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              disabled={!canStop || act.isPending}
              title={canStop ? t('stop') : t('stopDisabled')}
              onClick={() => setConfirmStop(true)}
            >
              <Square className="h-3.5 w-3.5" />
              {t('stop')}
            </Button>
            <Button
              size="sm"
              disabled={!canRestart || act.isPending}
              title={t('restart')}
              onClick={() => act.mutate('restart')}
            >
              <RotateCw className={act.isPending ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
              {t('restart')}
            </Button>
          </>
        )}
      </div>

      {startCommand ? (
        <div className="flex flex-wrap items-center gap-1 text-xs text-subtle">
          <span>{t('startCommand')}</span>
          <code className="min-w-0 truncate rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink">{startCommand}</code>
          <CopyButton value={startCommand} />
        </div>
      ) : null}

      {error ? <ErrorBox error={error} /> : null}
      {summary && viaRunner(summary) ? (
        <p className="text-xs text-muted">{t('startedViaRunner')}</p>
      ) : summary && !summary.ok ? (
        <p className="text-xs text-danger">
          {t('partial', { failed: summary.failed, succeeded: summary.succeeded })}
          {summary.results
            .filter((entry) => !entry.ok)
            .map((entry) => ` ${entry.service}: ${entry.error ?? ''}`)
            .join('')}
        </p>
      ) : null}

      <Dialog
        open={confirmStop}
        onOpenChange={setConfirmStop}
        title={t('stopConfirmTitle')}
        description={t('stopConfirm', { name: project.name, count: services.length })}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmStop(false)}>{t('cancel')}</Button>
            <Button variant="primary" disabled={act.isPending} onClick={() => act.mutate('stop')}>
              {t('stop')}
            </Button>
          </>
        }
      >
        <ul className="list-inside list-disc text-sm text-ink">
          {services.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      </Dialog>

      <Dialog
        open={confirmForget}
        onOpenChange={setConfirmForget}
        title={t('forgetConfirmTitle')}
        description={t('forgetConfirm', { name: project.name })}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmForget(false)}>{t('cancel')}</Button>
            <Button variant="primary" disabled={forget.isPending} onClick={() => forget.mutate()}>
              {t('forget')}
            </Button>
          </>
        }
      />
    </>
  )
}
