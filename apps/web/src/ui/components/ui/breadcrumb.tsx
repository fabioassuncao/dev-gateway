import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { cn } from '../../lib/utils.ts'

export interface BreadcrumbItem {
  label: string
  /** Where the crumb goes; the last item never has one. */
  href?: string
  /** The name is still loading: shown, but dimmed. */
  pending?: boolean
}

/**
 * Where a page sits: Projects › project › Tasks › #42. The tab is never a
 * crumb; the last item is the entity the page is about. On a narrow screen
 * only the parent and the current item stay visible.
 */
export function Breadcrumb({ items, className }: { items: BreadcrumbItem[]; className?: string }) {
  const { t } = useTranslation('common')
  if (items.length < 2) return null
  return (
    <nav aria-label={t('breadcrumb')} className={cn('mb-1 min-w-0', className)}>
      <ol className="flex min-w-0 items-center gap-1 overflow-hidden text-xs text-subtle whitespace-nowrap">
        {items.map((item, index) => {
          const last = index === items.length - 1
          return (
            <li key={`${index}-${item.label}`} className={cn('flex min-w-0 items-center gap-1', index < items.length - 2 && 'hidden sm:flex')}>
              {index > 0 ? (
                <ChevronRight
                  aria-hidden="true"
                  // The parent's separator would lead the trail once the items before it are hidden.
                  className={cn('h-3 w-3 shrink-0 opacity-50', index === items.length - 2 && items.length > 2 && 'hidden sm:block')}
                />
              ) : null}
              {last ? (
                <span aria-current="page" title={item.label} className="max-w-[16rem] truncate text-muted">
                  {item.label}
                </span>
              ) : item.href ? (
                <a
                  href={item.href}
                  title={item.label}
                  className={cn('max-w-[12rem] truncate underline-offset-2 hover:text-accent hover:underline', item.pending && 'opacity-60')}
                >
                  {item.label}
                </a>
              ) : (
                <span className="truncate">{item.label}</span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
