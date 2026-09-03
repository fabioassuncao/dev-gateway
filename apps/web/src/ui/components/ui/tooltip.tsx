import { cloneElement, useCallback, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/utils.ts'

/**
 * A label for something whose icon or colour is not self-explanatory.
 *
 * Written here rather than pulled in as a fifth Radix package: a tooltip is a
 * positioned box with `aria-describedby`, and the whole of it fits on one
 * screen. It appears on hover and on keyboard focus — an icon button that only
 * explains itself to a mouse explains itself to nobody — and leaves on Escape.
 *
 * It is never the only place a meaning lives. If a control needs a tooltip to
 * be usable at all, the control is wrong.
 */
export function Tooltip({
  label,
  children,
  side = 'top',
  delay = 250,
}: {
  label: ReactNode
  /** A single element that can take a ref and the pointer/focus handlers. */
  children: ReactElement<Record<string, unknown>>
  side?: 'top' | 'bottom' | 'left' | 'right'
  delay?: number
}) {
  const id = useId()
  const anchor = useRef<HTMLElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [box, setBox] = useState<{ top: number; left: number } | null>(null)

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setBox(null)
  }, [])

  const show = useCallback((immediate = false) => {
    if (timer.current) clearTimeout(timer.current)
    const place = () => {
      const element = anchor.current
      if (!element) return
      const rect = element.getBoundingClientRect()
      const gap = 6
      const point =
        side === 'bottom' ? { top: rect.bottom + gap, left: rect.left + rect.width / 2 }
          : side === 'left' ? { top: rect.top + rect.height / 2, left: rect.left - gap }
            : side === 'right' ? { top: rect.top + rect.height / 2, left: rect.right + gap }
              : { top: rect.top - gap, left: rect.left + rect.width / 2 }
      setBox(point)
    }
    if (immediate) place()
    else timer.current = setTimeout(place, delay)
  }, [delay, side])

  useEffect(() => {
    if (!box) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') hide() }
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', hide, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', hide, true)
    }
  }, [box, hide])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const transform =
    side === 'bottom' ? 'translate(-50%, 0)'
      : side === 'left' ? 'translate(-100%, -50%)'
        : side === 'right' ? 'translate(0, -50%)'
          : 'translate(-50%, -100%)'

  const trigger = cloneElement(children, {
    ref: (node: HTMLElement | null) => {
      anchor.current = node
      const forwarded = (children as unknown as { ref?: unknown }).ref
      if (typeof forwarded === 'function') forwarded(node)
      else if (forwarded && typeof forwarded === 'object') (forwarded as { current: unknown }).current = node
    },
    'aria-describedby': box ? id : undefined,
    onPointerEnter: () => show(),
    onPointerLeave: hide,
    onFocus: () => show(true),
    onBlur: hide,
  })

  return (
    <>
      {trigger}
      {box && typeof document !== 'undefined'
        ? createPortal(
            <div
              id={id}
              role="tooltip"
              style={{ top: box.top, left: box.left, transform }}
              className={cn(
                'pointer-events-none fixed z-[70] max-w-xs rounded border border-line bg-surface px-2 py-1',
                'text-xs leading-snug text-ink shadow-overlay',
              )}
            >
              {label}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

/**
 * The common case: an icon that needs a name. Saves repeating the trigger
 * markup, and guarantees the name reaches assistive technology too.
 */
export function IconHint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip label={label}>
      <span tabIndex={0} aria-label={label} className="inline-flex rounded outline-none focus-visible:outline-2 focus-visible:outline-accent">
        {children}
      </span>
    </Tooltip>
  )
}
