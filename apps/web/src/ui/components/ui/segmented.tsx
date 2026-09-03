import type { ComponentType } from 'react'
import { cn } from '../../lib/utils.ts'

export interface SegmentOption<Value extends string> {
  value: Value
  label: string
  icon?: ComponentType<{ className?: string }>
}

/**
 * A choice between two or three ways of looking at the same rows: board or
 * table, cards or table. One component so the switch sits in the same place,
 * at the same size, on every page that offers one — and so the arrow keys work
 * the same way, which they do not when each page rolls its own pair of buttons.
 */
export function Segmented<Value extends string>({
  options,
  value,
  onChange,
  label,
  /** Show only the icons; the label stays as the accessible name. */
  iconOnly = false,
  className,
}: {
  options: readonly SegmentOption<Value>[]
  value: Value
  onChange: (value: Value) => void
  label: string
  iconOnly?: boolean
  className?: string
}) {
  const move = (delta: number) => {
    const index = options.findIndex((option) => option.value === value)
    const next = options[(index + delta + options.length) % options.length]
    if (next) onChange(next.value)
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('inline-flex shrink-0 rounded-md border border-line bg-surface p-0.5', className)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); move(1) }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); move(-1) }
      }}
    >
      {options.map((option) => {
        const Icon = option.icon
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={iconOnly ? option.label : undefined}
            title={option.label}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors',
              selected ? 'bg-accent/12 font-medium text-accent' : 'text-muted hover:text-ink',
            )}
          >
            {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
            {iconOnly ? null : option.label}
          </button>
        )
      })}
    </div>
  )
}
