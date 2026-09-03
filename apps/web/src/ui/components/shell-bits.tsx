import type { ComponentType, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { cn } from '../lib/utils.ts'
import { translateApiError, translateApiHint } from '../i18n/translate-error.ts'
import { DocText } from './doc-text.tsx'
import { Breadcrumb, type BreadcrumbItem } from './ui/breadcrumb.tsx'

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
  /** A compact status strip that belongs to the page, under the title. */
  meta,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  /** Where the page sits; shown above the title when it has at least two steps. */
  breadcrumb?: BreadcrumbItem[]
  meta?: ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
      <div className="min-w-0">
        {breadcrumb && breadcrumb.length >= 2 ? <Breadcrumb items={breadcrumb} /> : null}
        <h1 className="text-lg font-semibold tracking-tight text-ink">{title}</h1>
        {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
        {meta ? <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function Loading({ label }: { label?: string }) {
  const { t } = useTranslation('common')
  return (
    <div role="status" className="flex items-center gap-2 px-4 py-8 text-sm text-muted">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {label ?? t('loading')}
    </div>
  )
}

/**
 * The shape of content that has not arrived, so a card does not collapse and
 * then jump. Used where the wait is long enough to see; a spinner is enough
 * for anything shorter.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded bg-surface-2', className)} />
}

export function SkeletonRows({ rows = 3, className }: { rows?: number; className?: string }) {
  const { t } = useTranslation('common')
  return (
    <div role="status" aria-label={t('loading')} className={cn('space-y-2 px-4 py-3', className)}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="h-3.5 w-3.5 rounded-full" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  )
}

export function ErrorBox({ error }: { error: unknown }) {
  const { t } = useTranslation()
  const raw = error instanceof Error ? error.message : String(error)
  const hint = (error as { hint?: string })?.hint
  const message = translateApiError(raw, hint, t)
  const translatedHint = hint ? translateApiHint(hint, t) : undefined
  return (
    <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        {message}
      </div>
      {translatedHint && translatedHint !== message ? (
        <p className="mt-1 pl-6 text-xs opacity-80">
          <DocText>{translatedHint}</DocText>
        </p>
      ) : null}
    </div>
  )
}

/**
 * A section with nothing in it yet.
 *
 * It says what the section is for and, where there is one, offers the action
 * that would fill it. `compact` is for a panel inside a dashboard: an empty
 * slot on a cockpit must not cost more space than a full one.
 */
export function Empty({
  title,
  hint,
  icon: Icon,
  action,
  compact = false,
  tone = 'neutral',
}: {
  title: string
  hint?: ReactNode
  icon?: ComponentType<{ className?: string }>
  action?: ReactNode
  compact?: boolean
  /** `ok` states the absence is good news: nothing needs attention. */
  tone?: 'neutral' | 'ok'
}) {
  if (compact) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 text-sm">
        {Icon ? <Icon className={cn('h-4 w-4 shrink-0', tone === 'ok' ? 'text-ok' : 'text-subtle')} aria-hidden /> : null}
        <span className={tone === 'ok' ? 'text-ok' : 'text-muted'}>{title}</span>
        {hint ? <span className="hidden text-xs text-subtle sm:inline">{typeof hint === 'string' ? <DocText>{hint}</DocText> : hint}</span> : null}
        {action ? <span className="ml-auto">{action}</span> : null}
      </div>
    )
  }
  return (
    <div className="px-4 py-8 text-center">
      {Icon ? (
        <Icon className={cn('mx-auto mb-2 h-5 w-5', tone === 'ok' ? 'text-ok' : 'text-subtle')} aria-hidden />
      ) : null}
      <p className={cn('text-sm', tone === 'ok' ? 'text-ok' : 'text-muted')}>{title}</p>
      {hint ? (
        <p className="mx-auto mt-1 max-w-lg text-xs text-subtle">
          {typeof hint === 'string' ? <DocText>{hint}</DocText> : hint}
        </p>
      ) : null}
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  )
}

export function StatTile({
  label,
  value,
  tone,
  hint,
}: {
  label: string
  value: ReactNode
  tone?: 'ok' | 'warn' | 'danger' | 'accent'
  hint?: string
}) {
  const color =
    tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'danger' ? 'text-danger' : tone === 'accent' ? 'text-accent' : 'text-ink'
  return (
    <div role="group" aria-label={label} className="rounded-lg border border-line bg-surface px-3 py-2.5">
      <div className="text-[11px] font-medium tracking-wide text-subtle uppercase">{label}</div>
      <div data-slot="value" className={cn('mt-1 text-2xl leading-none font-semibold tabular-nums', color)}>
        {value}
      </div>
      {hint ? <div className="mt-1 text-xs text-muted">{hint}</div> : null}
    </div>
  )
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 py-1">
      <dt className="w-40 shrink-0 text-xs text-subtle">{label}</dt>
      <dd className="min-w-0 text-sm text-ink">{children}</dd>
    </div>
  )
}
