import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils.ts'

export type ToastTone = 'neutral' | 'ok' | 'warn' | 'danger'

export interface ToastInput {
  title: string
  description?: string
  tone?: ToastTone
  /** Milliseconds before it goes away on its own. 0 keeps it until dismissed. */
  duration?: number
}

interface Toast extends ToastInput {
  id: number
  tone: ToastTone
}

interface ToastApi {
  push: (toast: ToastInput) => number
  dismiss: (id: number) => void
}

/**
 * Without a provider the hook still answers, and does nothing. A component
 * rendered alone in a test, or in a place the provider does not reach, should
 * not need a wrapper to exist.
 */
const NOOP: ToastApi = { push: () => 0, dismiss: () => {} }
const ToastContext = createContext<ToastApi>(NOOP)

export function useToast(): ToastApi {
  return useContext(ToastContext)
}

const DEFAULT_DURATION = 6_000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const counter = useRef(0)

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const push = useCallback((input: ToastInput) => {
    const id = ++counter.current
    const toast: Toast = { ...input, id, tone: input.tone ?? 'neutral' }
    setToasts((current) => [...current.slice(-4), toast])
    const duration = input.duration ?? DEFAULT_DURATION
    if (duration > 0) setTimeout(() => dismiss(id), duration)
    return id
  }, [dismiss])

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="region"
        aria-live="polite"
        aria-label="Notifications"
        className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === 'danger' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto flex items-start gap-2 rounded-md border bg-surface px-3 py-2 text-sm shadow-overlay',
              toast.tone === 'danger'
                ? 'border-danger/50'
                : toast.tone === 'warn'
                  ? 'border-warn/50'
                  : toast.tone === 'ok'
                    ? 'border-ok/50'
                    : 'border-line',
            )}
          >
            <div className="min-w-0 flex-1">
              <div className={cn('font-medium', toast.tone === 'danger' ? 'text-danger' : 'text-ink')}>{toast.title}</div>
              {toast.description ? <div className="mt-0.5 break-words text-xs text-muted">{toast.description}</div> : null}
            </div>
            <button
              type="button"
              className="rounded p-0.5 text-subtle hover:bg-surface-2 hover:text-ink"
              aria-label="Dismiss"
              onClick={() => dismiss(toast.id)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
