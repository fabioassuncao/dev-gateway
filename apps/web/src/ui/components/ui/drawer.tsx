import * as Primitive from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils.ts'

/**
 * A panel that slides in from the right and keeps the page behind it visible:
 * the detail of one row, opened without leaving the list. Same primitive as
 * the dialog, so focus, escape and the overlay behave the same way.
 */
export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 'md',
  className,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  width?: 'md' | 'lg'
  className?: string
}) {
  return (
    <Primitive.Root open={open} onOpenChange={onOpenChange}>
      <Primitive.Portal>
        <Primitive.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Primitive.Content
          data-side="right"
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex h-full flex-col border-l border-line bg-surface shadow-modal',
            width === 'lg' ? 'w-[min(96vw,56rem)]' : 'w-[min(94vw,40rem)]',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0">
              <Primitive.Title className="text-sm font-semibold text-ink">{title}</Primitive.Title>
              {description ? (
                <Primitive.Description className="mt-1 text-xs text-muted">{description}</Primitive.Description>
              ) : null}
            </div>
            <Primitive.Close className="rounded p-1 text-subtle hover:bg-surface-2 hover:text-ink">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Primitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 scroll-thin">{children}</div>
          {footer ? <div className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</div> : null}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  )
}
