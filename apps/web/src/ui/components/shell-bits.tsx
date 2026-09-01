import type { ReactNode } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { cn } from '../lib/utils.ts'

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-ink">{title}</h1>
        {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  )
}

export function ErrorBox({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error)
  const hint = (error as { hint?: string })?.hint
  return (
    <div className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle className="h-4 w-4" />
        {message}
      </div>
      {hint ? <p className="mt-1 pl-6 text-xs opacity-80">{hint}</p> : null}
    </div>
  )
}

export function Empty({ title, hint }: { title: string; hint?: ReactNode }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-sm text-muted">{title}</p>
      {hint ? <p className="mx-auto mt-1 max-w-lg text-xs text-subtle">{hint}</p> : null}
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
