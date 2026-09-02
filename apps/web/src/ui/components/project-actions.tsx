import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Play, RotateCw, Square } from 'lucide-react'
import type { Project, ProjectActionResult } from '../../shared/types.ts'
import { api } from '../lib/api.ts'
import { Button } from './ui/button.tsx'
import { Dialog } from './ui/dialog.tsx'
import { ErrorBox } from './shell-bits.tsx'

export function ProjectActions({ project }: { project: Project }) {
  const { t } = useTranslation('projects', { keyPrefix: 'actions' })
  const queryClient = useQueryClient()
  const [error, setError] = useState<unknown>(null)
  const [confirmStop, setConfirmStop] = useState(false)
  const [summary, setSummary] = useState<ProjectActionResult | null>(null)

  const act = useMutation({
    mutationFn: (action: 'start' | 'stop' | 'restart') => api.projectAction(project.name, action),
    onSuccess: (result) => {
      setSummary(result)
      setConfirmStop(false)
      void queryClient.invalidateQueries()
    },
    onError: setError,
  })

  const canStart = project.startable.ok
  const canStop = project.runningCount > 0
  const canRestart = project.serviceCount > 0
  const services = project.services.map((service) => service.service ?? service.name)

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
      </div>

      {error ? <ErrorBox error={error} /> : null}
      {summary && !summary.ok ? (
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
    </>
  )
}
