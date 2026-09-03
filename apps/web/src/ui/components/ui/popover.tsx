import * as Primitive from '@radix-ui/react-popover'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils.ts'

export const Popover = Primitive.Root
export const PopoverTrigger = Primitive.Trigger
export const PopoverClose = Primitive.Close

export function PopoverContent({
  children,
  align = 'start',
  className,
}: {
  children: ReactNode
  align?: 'start' | 'center' | 'end'
  className?: string
}) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        align={align}
        sideOffset={4}
        className={cn(
          'z-50 min-w-44 rounded-md border border-line bg-surface p-1 shadow-overlay outline-none',
          className,
        )}
      >
        {children}
      </Primitive.Content>
    </Primitive.Portal>
  )
}
