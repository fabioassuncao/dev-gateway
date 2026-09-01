import type { ReactNode } from 'react'
import { useRef } from 'react'
import { navigate } from '../../lib/router.ts'
import { cn } from '../../lib/utils.ts'

export interface TabDefinition {
  id: string
  label: string
  /** Hash path this tab navigates to. A tab is a URL, never component state. */
  href: string
}

/**
 * A tab list that navigates instead of holding state.
 *
 * Each tab is an anchor to a hash path, so a tab is addressable, survives a
 * reload and moves with the browser's back button. Radix is already a
 * dependency for dialog, menu and switch; a link list needs twenty lines and
 * no fourth package.
 */
export function Tabs({
  tabs,
  active,
  label,
  className,
}: {
  tabs: TabDefinition[]
  active: string
  label: string
  className?: string
}) {
  const list = useRef<HTMLDivElement>(null)

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
    if (!keys.includes(event.key)) return
    event.preventDefault()

    const index = tabs.findIndex((tab) => tab.id === active)
    const last = tabs.length - 1
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? last
          : event.key === 'ArrowLeft'
            ? (index <= 0 ? last : index - 1)
            : (index >= last ? 0 : index + 1)

    const target = tabs[next]
    if (!target) return
    navigate(target.href)
    // Roving focus follows the selection, which is what a tablist promises.
    list.current?.querySelector<HTMLElement>(`[data-tab="${target.id}"]`)?.focus()
  }

  return (
    <div
      ref={list}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn('flex gap-1 overflow-x-auto border-b border-line scroll-thin', className)}
    >
      {tabs.map((tab) => {
        const selected = tab.id === active
        return (
          <a
            key={tab.id}
            role="tab"
            data-tab={tab.id}
            href={`#${tab.href}`}
            aria-selected={selected}
            aria-controls={`tabpanel-${tab.id}`}
            id={`tab-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            className={cn(
              '-mb-px border-b-2 px-3 py-1.5 text-sm whitespace-nowrap transition-colors',
              selected
                ? 'border-accent font-medium text-accent'
                : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {tab.label}
          </a>
        )
      })}
    </div>
  )
}

export function TabPanel({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`tabpanel-${id}`} aria-labelledby={`tab-${id}`} tabIndex={0} className="pt-4 outline-none">
      {children}
    </div>
  )
}
