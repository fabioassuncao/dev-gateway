import { useTranslation } from 'react-i18next'
import { slug } from '../../../shared/slug.ts'
import { cn } from '../../lib/utils.ts'
import { Badge } from '../ui/badge.tsx'

export function SettingsNav({
  groups,
  active,
  dirtyCounts,
}: {
  groups: string[]
  active: string | null
  dirtyCounts: ReadonlyMap<string, number>
}) {
  const { t } = useTranslation('settings')
  const { t: tc } = useTranslation('common')

  return (
    <nav
      aria-label={t('navLabel', { defaultValue: 'Settings groups' })}
      className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-2 md:sticky md:top-0 md:mx-0 md:w-44 md:shrink-0 md:flex-col md:overflow-visible md:px-0 md:pb-0 scroll-thin"
    >
      {groups.map((group) => {
        const groupSlug = slug(group)
        const selected = group === active
        const dirty = dirtyCounts.get(group) ?? 0
        const label = t(`groups.${group}`, { defaultValue: group })
        return (
          <a
            key={group}
            href={`#/settings/${groupSlug}`}
            aria-label={dirty > 0 ? `${label}, ${tc('unsaved', { count: dirty })}` : undefined}
            aria-current={selected ? 'page' : undefined}
            className={cn(
              'flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors',
              selected
                ? 'bg-accent/12 font-medium text-accent'
                : 'text-muted hover:bg-surface-2 hover:text-ink',
            )}
          >
            <span>{label}</span>
            {dirty > 0 ? <Badge tone="warn">{dirty}</Badge> : null}
          </a>
        )
      })}
    </nav>
  )
}
