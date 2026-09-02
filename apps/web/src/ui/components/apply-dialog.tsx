import { useTranslation } from 'react-i18next'
import { CheckCircle2, Circle, Loader2, TriangleAlert } from 'lucide-react'
import { Dialog } from './ui/dialog.tsx'
import { Button } from './ui/button.tsx'
import { CopyButton } from './copy.tsx'
import { mmss, type ApplyMachine } from '../lib/use-apply.ts'

function Step({ done, active, label }: { done: boolean; active?: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      {done ? (
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-ok" />
      ) : active ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
      ) : (
        <Circle className="h-3.5 w-3.5 shrink-0 text-subtle" />
      )}
      <span className={done ? 'text-ink' : 'text-muted'}>{label}</span>
    </li>
  )
}

function Command({ value, label }: { value: string; label: string }) {
  return (
    <div className="mt-3 flex items-center gap-2 rounded border border-line bg-surface-2 px-2 py-1.5">
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{value}</code>
      <CopyButton value={value} label={label} />
    </div>
  )
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
              <li key={key} className="font-mono text-xs text-ink">{key}</li>
            ))}
          </ul>
        ) : null}
        <p className="text-xs text-muted">{t('confirmPanel')}</p>
        <p className="mt-1 text-xs text-muted">{t('confirmProjects')}</p>
        {status?.movesPanel ? (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-warn">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
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
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
          {/* Spelled out rather than interpolated: only these three phases
              are busy, and the keys are type-checked against the catalogue. */}
          <span>
            {phase === 'starting' ? t('phase.starting') : phase === 'applying' ? t('phase.applying') : t('phase.waiting')}
          </span>
          <span className="ml-auto font-mono tabular-nums text-muted">{mmss(elapsedSeconds)}</span>
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
            <pre className="mt-2 max-h-64 overflow-auto rounded border border-line bg-surface-2 p-2 font-mono text-[11px] text-ink scroll-thin">
              {status.logTail.join('\n')}
            </pre>
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
