import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/utils.ts'

const badge = cva(
  'inline-flex items-center gap-1 rounded border font-medium leading-none whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'border-line-strong/70 bg-surface-2 text-muted',
        accent: 'border-accent/40 bg-accent/10 text-accent',
        ok: 'border-ok/40 bg-ok/10 text-ok',
        warn: 'border-warn/40 bg-warn/10 text-warn',
        danger: 'border-danger/40 bg-danger/10 text-danger',
        info: 'border-info/40 bg-info/10 text-info',
        agent: 'border-agent/40 bg-agent/10 text-agent',
        outline: 'border-line-strong text-subtle',
      },
      size: {
        sm: 'px-1.5 py-0.5 text-[11px]',
        md: 'px-2 py-1 text-xs',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'sm' },
  },
)

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badge> {
  /** A filled dot in the badge's own tone, for a state that is worth a glance. */
  dot?: boolean
}

export function Badge({ className, tone, size, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badge({ tone, size }), className)} {...props}>
      {dot ? <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" /> : null}
      {children}
    </span>
  )
}

/**
 * A state as a coloured dot, for the places a word would not fit: a row's
 * leading marker, a legend, a count beside a label. Always carries its own
 * accessible name, because a colour alone says nothing to a screen reader.
 */
export function StatusDot({
  tone = 'neutral',
  label,
  pulse = false,
  className,
}: {
  tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'info' | 'agent'
  label: string
  /** For something that is happening right now, not merely true right now. */
  pulse?: boolean
  className?: string
}) {
  const colour =
    tone === 'ok' ? 'bg-ok'
      : tone === 'warn' ? 'bg-warn'
        : tone === 'danger' ? 'bg-danger'
          : tone === 'info' ? 'bg-info'
            : tone === 'agent' ? 'bg-agent'
              : tone === 'accent' ? 'bg-accent'
                : 'bg-subtle'
  return (
    <span className={cn('relative inline-flex h-2 w-2 shrink-0', className)} title={label}>
      {pulse ? (
        <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', colour)} aria-hidden />
      ) : null}
      <span className={cn('relative inline-flex h-2 w-2 rounded-full', colour)} aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  )
}
