import type { ReactNode } from 'react'
import { cn } from '../../lib/utils.ts'

/** An ordered list with a rail: what happened, in the order it happened. */
export function Timeline({ children, className }: { children: ReactNode; className?: string }) {
  return <ol className={cn('relative space-y-0 border-l border-line pl-4', className)}>{children}</ol>
}

export function TimelineItem({
  marker,
  time,
  children,
  tone = 'neutral',
}: {
  marker?: ReactNode
  time?: ReactNode
  children: ReactNode
  tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'info'
}) {
  const dot =
    tone === 'ok' ? 'bg-ok' : tone === 'warn' ? 'bg-warn' : tone === 'danger' ? 'bg-danger' : tone === 'info' ? 'bg-accent' : 'bg-subtle'
  return (
    <li className="relative py-1.5 text-sm">
      <span className={cn('absolute top-2.5 -left-[1.3rem] h-2 w-2 rounded-full ring-2 ring-surface', dot)} aria-hidden>
        {marker}
      </span>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        {time ? <span className="shrink-0 font-mono text-[11px] text-subtle">{time}</span> : null}
        <div className="min-w-0 flex-1 text-ink">{children}</div>
      </div>
    </li>
  )
}
