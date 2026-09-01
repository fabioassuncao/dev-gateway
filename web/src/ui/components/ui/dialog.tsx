import * as Primitive from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils.ts'

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  className?: string
}) {
  return (
    <Primitive.Root open={open} onOpenChange={onOpenChange}>
      <Primitive.Portal>
        <Primitive.Overlay className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[1px]" />
        <Primitive.Content
          className={cn(
            'fixed top-1/2 left-1/2 z-50 w-[min(92vw,34rem)] -translate-x-1/2 -translate-y-1/2',
            'rounded-lg border border-line bg-surface shadow-xl',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0">
              <Primitive.Title className="text-sm font-semibold text-ink">{title}</Primitive.Title>
              {description ? (
                <Primitive.Description className="mt-1 text-xs text-muted">
                  {description}
                </Primitive.Description>
              ) : null}
            </div>
            <Primitive.Close className="rounded p-1 text-subtle hover:bg-surface-2 hover:text-ink">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Primitive.Close>
          </div>
          <div className="max-h-[60vh] overflow-y-auto px-4 py-3 scroll-thin">{children}</div>
          {footer ? (
            <div className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>
          ) : null}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  )
}
