import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/utils.ts'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('overflow-hidden rounded-lg border border-line bg-surface shadow-raised', className)}
      {...props}
    />
  )
}

export function CardHeader({
  title,
  description,
  actions,
  /** A number, a state, an age: what the header is worth knowing at a glance. */
  meta,
  icon,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  meta?: ReactNode
  icon?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-start justify-between gap-3 border-b border-line px-4 py-2.5', className)}>
      <div className="flex min-w-0 items-start gap-2">
        {icon ? <span className="mt-0.5 shrink-0 text-subtle">{icon}</span> : null}
        <div className="min-w-0">
          <h2 className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-semibold text-ink">
            {title}
            {meta}
          </h2>
          {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  )
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-4 py-3', className)} {...props} />
}

/**
 * A labelled band inside a card, for a list that has more than one part —
 * the board columns of the work panel, the groups of a settings page. The
 * label is quieter than a card header on purpose: it is a divider, not a title.
 */
export function CardSection({
  label,
  count,
  actions,
  children,
  className,
}: {
  label: ReactNode
  count?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <div className="flex items-center gap-2 border-t border-line bg-surface-2/50 px-4 py-1.5 text-[11px] font-semibold tracking-wider text-subtle uppercase first:border-t-0">
        <span className="min-w-0 truncate">{label}</span>
        {count !== undefined && count !== null ? <span className="tabular-nums text-muted">{count}</span> : null}
        {actions ? <span className="ml-auto normal-case">{actions}</span> : null}
      </div>
      {children}
    </div>
  )
}
