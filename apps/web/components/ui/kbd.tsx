'use client'

import type { ReactNode } from 'react'
import { cn } from '../../lib/utils.ts'

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** The modifier key as the platform writes it. */
export const MOD_KEY = MAC ? '⌘' : 'Ctrl'

/**
 * A key, drawn as a key. Used in menus, in the command palette and in
 * tooltips so a shortcut is discoverable where the action is.
 */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-xs border border-line bg-surface-2 px-1',
        'font-sans text-2xs font-medium text-subtle tabular-nums',
        className,
      )}
    >
      {children}
    </kbd>
  )
}

/** `⌘ K`, `G then P`: a sequence of keys with the spacing the eye expects. */
export function Shortcut({ keys, className }: { keys: readonly string[]; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)} aria-hidden>
      {keys.map((key, index) => (
        <Kbd key={`${key}-${index}`}>{key === 'mod' ? MOD_KEY : key}</Kbd>
      ))}
    </span>
  )
}
