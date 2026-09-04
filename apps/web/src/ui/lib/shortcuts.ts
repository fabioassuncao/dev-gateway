import { useEffect } from 'react'

/** True when the key press belongs to a field the person is typing in. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable ||
    target.closest('[contenteditable="true"]') !== null
  )
}

export interface ShortcutSpec {
  /** `event.key`, compared case-insensitively. */
  key: string
  /** Cmd on a Mac, Ctrl elsewhere. */
  mod?: boolean
  shift?: boolean
  /** Fire even while typing in a field: only for shortcuts that use a modifier. */
  whileTyping?: boolean
}

function matches(event: KeyboardEvent, spec: ShortcutSpec): boolean {
  if (event.key.toLowerCase() !== spec.key.toLowerCase()) return false
  const mod = event.metaKey || event.ctrlKey
  if (Boolean(spec.mod) !== mod) return false
  if (Boolean(spec.shift) !== event.shiftKey) return false
  if (event.altKey) return false
  return true
}

/**
 * A keyboard shortcut that works anywhere on the page.
 *
 * Plain keys stay quiet while a field has focus, so typing `[` in a search
 * box does not fold the sidebar. Modifier shortcuts fire everywhere, which is
 * what a person pressing ⌘K in a comment box expects.
 */
export function useShortcut(spec: ShortcutSpec | ShortcutSpec[], handler: (event: KeyboardEvent) => void): void {
  useEffect(() => {
    const specs = Array.isArray(spec) ? spec : [spec]
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      for (const candidate of specs) {
        if (!matches(event, candidate)) continue
        if (!candidate.whileTyping && !candidate.mod && isTypingTarget(event.target)) return
        event.preventDefault()
        handler(event)
        return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // The spec is data; callers pass literals, and the handler is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handler, JSON.stringify(spec)])
}
