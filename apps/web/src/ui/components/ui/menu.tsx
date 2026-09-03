import * as Primitive from '@radix-ui/react-dropdown-menu'
import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils.ts'

export const Menu = Primitive.Root
export const MenuTrigger = Primitive.Trigger

export function MenuContent({
  children,
  align = 'end',
  className,
}: {
  children: ReactNode
  align?: 'start' | 'end'
  className?: string
}) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        align={align}
        sideOffset={4}
        collisionPadding={8}
        className={cn(
          'z-50 max-h-[min(28rem,var(--radix-dropdown-menu-content-available-height))] min-w-44 overflow-y-auto',
          'rounded-md border border-line bg-surface p-1 shadow-overlay scroll-thin',
          className,
        )}
      >
        {children}
      </Primitive.Content>
    </Primitive.Portal>
  )
}

/** Names what the items below it are for, when a menu holds more than one group. */
export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <Primitive.Label className="px-2 py-1 text-[11px] font-semibold tracking-wider text-subtle uppercase">
      {children}
    </Primitive.Label>
  )
}

export function MenuItem({
  children,
  onSelect,
  disabled,
  tone,
  /** Shown dimmed at the end of the row: a shortcut, a count, a state. */
  hint,
  title,
}: {
  children: ReactNode
  onSelect?: () => void
  disabled?: boolean
  tone?: 'danger'
  hint?: ReactNode
  title?: string
}) {
  return (
    <Primitive.Item
      disabled={disabled}
      onSelect={onSelect}
      title={title}
      className={cn(
        'flex cursor-default items-center gap-2 rounded px-2 py-1.5 text-sm outline-none',
        'data-[highlighted]:bg-surface-2 data-[disabled]:opacity-40',
        tone === 'danger' ? 'text-danger data-[highlighted]:bg-danger/10' : 'text-ink',
      )}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
      {hint ? <span className="shrink-0 text-[11px] text-subtle">{hint}</span> : null}
    </Primitive.Item>
  )
}

/** An item that is on or off and keeps the menu open: a column, a filter. */
export function MenuToggle({
  children,
  checked,
  onCheckedChange,
  disabled,
}: {
  children: ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <Primitive.CheckboxItem
      checked={checked}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
      onSelect={(event) => event.preventDefault()}
      className={cn(
        'flex cursor-default items-center gap-2 rounded py-1.5 pr-2 pl-7 text-sm text-ink outline-none',
        'relative data-[highlighted]:bg-surface-2 data-[disabled]:opacity-40',
      )}
    >
      <Primitive.ItemIndicator className="absolute left-1.5 flex items-center">
        <Check className="h-3.5 w-3.5 text-accent" />
      </Primitive.ItemIndicator>
      {children}
    </Primitive.CheckboxItem>
  )
}

export function MenuSeparator() {
  return <Primitive.Separator className="my-1 h-px bg-line" />
}
