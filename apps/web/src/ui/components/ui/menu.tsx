import * as Primitive from '@radix-ui/react-dropdown-menu'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils.ts'

export const Menu = Primitive.Root
export const MenuTrigger = Primitive.Trigger

export function MenuContent({ children, align = 'end' }: { children: ReactNode; align?: 'start' | 'end' }) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        align={align}
        sideOffset={4}
        className="z-50 min-w-40 rounded-md border border-line bg-surface p-1 shadow-lg"
      >
        {children}
      </Primitive.Content>
    </Primitive.Portal>
  )
}

export function MenuItem({
  children,
  onSelect,
  disabled,
  tone,
}: {
  children: ReactNode
  onSelect?: () => void
  disabled?: boolean
  tone?: 'danger'
}) {
  return (
    <Primitive.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        'flex cursor-default items-center gap-2 rounded px-2 py-1.5 text-sm outline-none',
        'data-[highlighted]:bg-surface-2 data-[disabled]:opacity-40',
        tone === 'danger' ? 'text-danger' : 'text-ink',
      )}
    >
      {children}
    </Primitive.Item>
  )
}

export function MenuSeparator() {
  return <Primitive.Separator className="my-1 h-px bg-line" />
}
