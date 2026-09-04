import { useTranslation } from 'react-i18next'
import { CheckCircle2, Circle, Loader2, TriangleAlert } from 'lucide-react'
import { Dialog } from './ui/dialog.tsx'
import { Button } from './ui/button.tsx'
import { CommandRow, Mono, Pre } from './copy.tsx'
import { mmss, type ApplyMachine } from '../lib/use-apply.ts'

function Step({ done, active, label }: { done: boolean; active?: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      {done ? (
        <CheckCircle2 className="size-3.5 shrink-0 text-ok" />
      ) : active ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-accent" />
      ) : (
        <Circle className="size-3.5 shrink-0 text-subtle" />
      )}
      <span className={done ? 'text-ink' : 'text-muted'}>{label}</span>
    </li>
  )
}

function Command({ value }: { value: string; label: string }) {
  return <CommandRow command={value} className="mt-3" />
}

export function ApplyDialog({ machine }: { machine: ApplyMachine }) {
  const { t } = useTranslation('gateway', { keyPrefix: 'apply' })
  const { t: tc } = useTranslation('common')
  const { phase, busy, status, elapsedSeconds, sawOffline } = machine
  const command = status?.applyCommand ?? './bin/portta up'

  if (phase === 'confirming') {
    return (
      <Dialog
        open
        onOpenChange={(next) => !next && machine.dismiss()}
        title={t('confirmTitle')}
        description={t('confirmDescription')}
        footer={
          <>
            <Button variant="ghost" onClick={machine.dismiss}>{tc('cancel')}</Button>
            <Button variant="primary" onClick={machine.confirm}>{t('confirm')}</Button>
          </>
        }
      >
        {status && status.pendingKeys.length > 0 ? (
          <ul className="mb-3 space-y-1">
            {status.pendingKeys.map((key) => (
              <li key={key}><Mono kind="text" tone="ink" className="text-xs">{key}</Mono></li>
            ))}
          </ul>
        ) : null}
        <p className="text-xs text-muted">{t('confirmPanel')}</p>
        <p className="mt-1 text-xs text-muted">{t('confirmProjects')}</p>
        {status?.movesPanel ? (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-warn">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>{t('confirmMoves')}</span>
          </p>
        ) : null}
        {/* The difference between ten seconds and five minutes. Without it, a
            first apply on a checkout reads as a hang. */}
        {status?.buildsImages ? (
          <p className="mt-2 text-xs text-muted">{t('confirmBuild')}</p>
        ) : null}
        <p className="mt-2 text-xs text-subtle">{t('confirmKeepTab')}</p>
      </Dialog>
    )
  }

  if (busy) {
    return (
      <Dialog
        open
        dismissible={false}
        onOpenChange={() => {}}
        title={t('title')}
        description={t('keepTabOpen')}
      >
        <div className="flex items-center gap-2 text-sm text-ink">
          <Loader2 className="size-4 shrink-0 animate-spin text-accent" />
          {/* Spelled out rather than interpolated: only these three phases
              are busy, and the keys are type-checked against the catalogue. */}
          <span>
            {phase === 'starting' ? t('phase.starting') : phase === 'applying' ? t('phase.applying') : t('phase.waiting')}
          </span>
          <Mono kind="text" className="ml-auto tabular-nums">{mmss(elapsedSeconds)}</Mono>
        </div>
        {/* The step list is the progress indicator. A percentage bar would be a
            guess: nothing here knows how long recreating this host takes. */}
        <ol className="mt-3 space-y-1 text-xs" aria-live="polite">
          <Step done label={t('steps.started')} />
          <Step done={sawOffline} active={!sawOffline} label={t('steps.offline')} />
          <Step done={false} active={sawOffline} label={t('steps.back')} />
          <Step done={false} label={t('steps.applied')} />
        </ol>
      </Dialog>
    )
  }

  if (phase === 'reconnected') {
    return (
      <Dialog
        open
        onOpenChange={(next) => !next && machine.dismiss()}
        title={t('phase.reconnected')}
        footer={
          <>
            <Button variant="ghost" onClick={machine.dismiss}>{tc('close')}</Button>
            <Button variant="primary" onClick={() => window.location.reload()}>{t('reload')}</Button>
          </>
        }
      >
        <ol className="space-y-1 text-xs">
          <Step done label={t('steps.started')} />
          <Step done={sawOffline} label={t('steps.offline')} />
          <Step done label={t('steps.back')} />
          <Step done label={t('steps.applied')} />
        </ol>
        {/* The page is still showing data the previous process answered with. */}
        <p className="mt-3 text-xs text-muted">{t('reloadWhy')}</p>
      </Dialog>
    )
  }

  if (phase === 'failed') {
    return (
      <Dialog
        open
        onOpenChange={(next) => !next && machine.dismiss()}
        title={t('phase.failed')}
        footer={<Button variant="ghost" onClick={machine.dismiss}>{tc('close')}</Button>}
      >
        <p className="text-sm text-danger">
          {t('failedExit', { code: status?.exitCode ?? '?' })}
        </p>
        {status && status.logTail.length > 0 ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-muted">{t('showOutput')}</summary>
            <Pre className="mt-2">{status.logTail.join('\n')}</Pre>
          </details>
        ) : null}
        <p className="mt-3 text-xs text-muted">{t('failedHint')}</p>
        <Command value={command} label={tc('copyCommand')} />
      </Dialog>
    )
  }

  if (phase === 'timeout') {
    return (
      <Dialog
        open
        onOpenChange={(next) => !next && machine.dismiss()}
        title={t('phase.timeout')}
        footer={
          <>
            <Button variant="ghost" onClick={machine.dismiss}>{tc('close')}</Button>
            <Button variant="primary" onClick={() => window.location.reload()}>{t('reload')}</Button>
          </>
        }
      >
        {/* Deliberately not "it failed": a slow host and a broken one look the
            same from a browser that cannot reach the panel. */}
        <p className="text-sm text-warn">{t('timeoutBody', { time: mmss(elapsedSeconds) })}</p>
        <Command value={command} label={tc('copyCommand')} />
      </Dialog>
    )
  }

  return null
}
