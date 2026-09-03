import type { ReactNode } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx'
import { cn } from '../../lib/utils.ts'

export function PropertyRow({
  label,
  children,
  empty,
}: {
  label: string
  children: ReactNode
  empty?: boolean
}) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-2 py-1.5">
      <dt className="pt-0.5 text-[11px] font-medium tracking-wide text-subtle uppercase">{label}</dt>
      <dd className={cn('min-w-0 text-sm', empty ? 'text-subtle' : 'text-ink')}>{children}</dd>
    </div>
  )
}

export function PropertyButton({
  children,
  disabled,
  empty,
}: {
  children: ReactNode
  disabled?: boolean
  empty?: boolean
}) {
  return (
    <PopoverTrigger
      disabled={disabled}
      className={cn(
        'inline-flex max-w-full items-center rounded-md px-1.5 py-0.5 text-left text-sm outline-none',
        'hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/40',
        empty ? 'text-subtle' : 'text-ink',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
    </PopoverTrigger>
  )
}

export function PropertyMenu({
  label,
  value,
  empty,
  disabled,
  children,
}: {
  label: string
  value: ReactNode
  empty?: boolean
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <PropertyRow label={label} empty={empty}>
      <Popover>
        <PropertyButton disabled={disabled} empty={empty}>{value}</PropertyButton>
        <PopoverContent>{children}</PopoverContent>
      </Popover>
    </PropertyRow>
  )
}

export function PropertyChoice({
  children,
  selected,
  onSelect,
}: {
  children: ReactNode
  selected?: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center rounded px-2 py-1.5 text-left text-sm outline-none',
        selected ? 'bg-accent/12 text-accent' : 'text-ink hover:bg-surface-2',
      )}
    >
      {children}
    </button>
  )
}
