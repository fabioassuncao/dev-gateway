import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, ChevronsUpDown, Columns3, X } from 'lucide-react'
import { cn } from '../../lib/utils.ts'
import {
  defaultHidden,
  nextSort,
  pruneSelection,
  readArrangement,
  sortRows,
  toggleHidden,
  visibleColumns,
  writeArrangement,
  type Column,
  type SortState,
} from '../../lib/table.ts'
import { Button } from './button.tsx'
import { Menu, MenuContent, MenuLabel, MenuSeparator, MenuTrigger, MenuToggle } from './menu.tsx'
import { Empty } from '../shell-bits.tsx'

export type { Column, SortState } from '../../lib/table.ts'

const PRIORITY_CLASS: Record<number, string> = {
  1: '',
  2: 'hidden lg:table-cell',
  3: 'hidden xl:table-cell',
}

export interface BulkAction {
  id: string
  label: string
  icon?: ReactNode
  tone?: 'danger'
  /** Reasons a selection cannot take this action; when set, it is offered disabled with the reason. */
  disabledReason?: string
  onRun: () => void
}

/**
 * The panel's one table.
 *
 * Every structured list — projects, tasks, services — renders through this so
 * sorting, hiding a column, selecting rows and acting on a selection behave
 * identically wherever they appear, and so the operator's arrangement of a
 * given table survives a reload.
 *
 * What it deliberately does not do: paginate (the panel's lists are a
 * developer's own projects, not a catalogue), or reflow into cards on a narrow
 * screen. Columns leave by priority instead, and the identity column stays
 * pinned to the left edge while the rest scrolls.
 */
export function DataTable<Row>({
  rows,
  columns,
  rowKey,
  storageKey,
  initialSort = null,
  selectable = false,
  bulkActions,
  onRowActivate,
  rowClassName,
  rowLabel,
  empty,
  emptyTitle,
  emptyHint,
  toolbar,
  caption,
  className,
}: {
  rows: readonly Row[]
  columns: readonly Column<Row>[]
  rowKey: (row: Row) => string
  /** Where this table's column visibility and sort are remembered. */
  storageKey: string
  initialSort?: SortState | null
  selectable?: boolean
  /** Given the selected rows, what may be done to them. */
  bulkActions?: (selected: Row[], clear: () => void) => BulkAction[]
  /** Enter, or a click that did not land on a control, opens the row. */
  onRowActivate?: (row: Row) => void
  rowClassName?: (row: Row) => string | undefined
  rowLabel?: (row: Row) => string
  empty?: ReactNode
  emptyTitle?: string
  emptyHint?: string
  toolbar?: ReactNode
  caption?: string
  className?: string
}) {
  const { t } = useTranslation('common', { keyPrefix: 'table' })
  const stored = useRef<ReturnType<typeof readArrangement>>(undefined as never)
  if (stored.current === undefined) stored.current = readArrangement(storageKey)

  const [hidden, setHidden] = useState<string[]>(() => stored.current?.hidden ?? defaultHidden(columns))
  const [sort, setSort] = useState<SortState | null>(() => stored.current?.sort ?? initialSort)
  const [selection, setSelection] = useState<string[]>([])

  useEffect(() => {
    writeArrangement(storageKey, { hidden, sort })
  }, [hidden, sort, storageKey])

  const present = useMemo(() => rows.map(rowKey), [rows, rowKey])
  useEffect(() => {
    setSelection((current) => {
      const pruned = pruneSelection(current, present)
      return pruned.length === current.length ? current : pruned
    })
  }, [present])

  const shown = useMemo(() => visibleColumns(columns, hidden), [columns, hidden])
  const ordered = useMemo(() => sortRows(rows, columns, sort), [rows, columns, sort])
  const hideable = columns.filter((column) => !column.pinned)

  const selected = useMemo(() => ordered.filter((row) => selection.includes(rowKey(row))), [ordered, selection, rowKey])
  const clear = () => setSelection([])
  const actions = bulkActions && selected.length > 0 ? bulkActions(selected, clear) : []

  const allSelected = ordered.length > 0 && selection.length === ordered.length
  const someSelected = selection.length > 0 && !allSelected

  if (rows.length === 0 && !toolbar) {
    return <>{empty ?? <Empty title={emptyTitle ?? t('empty')} hint={emptyHint} />}</>
  }

  return (
    <div className={cn('min-w-0', className)}>
      {(toolbar || hideable.length > 0) ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          {toolbar}
          {hideable.length > 0 ? (
            <div className="ml-auto">
              <Menu>
                <MenuTrigger asChild>
                  <Button variant="ghost" size="sm" aria-label={t('columns')} title={t('columns')}>
                    <Columns3 className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{t('columns')}</span>
                  </Button>
                </MenuTrigger>
                <MenuContent>
                  <MenuLabel>{t('columnsHint')}</MenuLabel>
                  <MenuSeparator />
                  {hideable.map((column) => (
                    <MenuToggle
                      key={column.id}
                      checked={!hidden.includes(column.id)}
                      onCheckedChange={() => setHidden((current) => toggleHidden(columns, current, column.id))}
                    >
                      {column.srHeader ?? column.header}
                    </MenuToggle>
                  ))}
                </MenuContent>
              </Menu>
            </div>
          ) : null}
        </div>
      ) : null}

      {selected.length > 0 ? (
        <div
          role="region"
          aria-label={t('selectionActions')}
          className="flex flex-wrap items-center gap-2 border-b border-accent/30 bg-accent/[0.07] px-3 py-2"
        >
          <span className="text-xs font-medium text-accent">{t('selected', { count: selected.length })}</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {actions.map((action) => (
              <Button
                key={action.id}
                size="sm"
                variant={action.tone === 'danger' ? 'danger' : 'default'}
                disabled={Boolean(action.disabledReason)}
                title={action.disabledReason ?? action.label}
                onClick={action.onRun}
              >
                {action.icon}
                {action.label}
              </Button>
            ))}
          </div>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={clear}>
            <X className="h-3.5 w-3.5" />
            {t('clearSelection')}
          </Button>
        </div>
      ) : null}

      {ordered.length === 0 ? (
        empty ?? <Empty title={emptyTitle ?? t('empty')} hint={emptyHint} />
      ) : (
        <div className="w-full overflow-x-auto scroll-thin">
          <table className="w-full border-collapse text-sm table-sticky-first">
            {caption ? <caption className="sr-only">{caption}</caption> : null}
            <thead>
              <tr>
                {selectable ? (
                  <th scope="col" className="w-9 border-b border-line px-3 py-2 text-left">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-[var(--portta-accent)]"
                      aria-label={t('selectAll')}
                      checked={allSelected}
                      ref={(node) => { if (node) node.indeterminate = someSelected }}
                      onChange={() => setSelection(allSelected ? [] : ordered.map(rowKey))}
                    />
                  </th>
                ) : null}
                {shown.map((column) => {
                  const sortable = Boolean(column.sortValue)
                  const active = sort?.columnId === column.id
                  const Icon = !active ? ChevronsUpDown : sort?.direction === 'asc' ? ArrowUp : ArrowDown
                  return (
                    <th
                      key={column.id}
                      scope="col"
                      aria-sort={active ? (sort?.direction === 'asc' ? 'ascending' : 'descending') : sortable ? 'none' : undefined}
                      className={cn(
                        'border-b border-line px-3 py-2 text-[11px] font-semibold tracking-wide text-subtle uppercase',
                        column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left',
                        PRIORITY_CLASS[column.priority ?? 1],
                        column.headerClassName,
                      )}
                    >
                      {sortable ? (
                        <button
                          type="button"
                          onClick={() => setSort((current) => nextSort(current, column.id))}
                          className={cn(
                            'inline-flex items-center gap-1 rounded uppercase transition-colors hover:text-ink',
                            active && 'text-accent',
                            column.align === 'right' && 'flex-row-reverse',
                          )}
                        >
                          {column.header}
                          <Icon className={cn('h-3 w-3', !active && 'opacity-40')} aria-hidden />
                        </button>
                      ) : (
                        <span>{column.header || <span className="sr-only">{column.srHeader}</span>}</span>
                      )}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {ordered.map((row) => {
                const id = rowKey(row)
                const picked = selection.includes(id)
                return (
                  <tr
                    key={id}
                    aria-label={rowLabel?.(row)}
                    aria-selected={selectable ? picked : undefined}
                    tabIndex={onRowActivate ? 0 : undefined}
                    onKeyDown={(event) => {
                      if (!onRowActivate) return
                      if (event.key === 'Enter' && event.target === event.currentTarget) {
                        event.preventDefault()
                        onRowActivate(row)
                      }
                    }}
                    className={cn(
                      'group outline-none transition-colors',
                      picked ? 'bg-accent/[0.07]' : 'hover:bg-surface-2/70',
                      'focus-visible:bg-surface-2',
                      onRowActivate && 'cursor-default',
                      rowClassName?.(row),
                    )}
                  >
                    {selectable ? (
                      <td className="border-b border-line/70 px-3 py-2 align-middle">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 accent-[var(--portta-accent)]"
                          aria-label={t('selectRow', { name: rowLabel?.(row) ?? id })}
                          checked={picked}
                          onChange={() =>
                            setSelection((current) => (picked ? current.filter((entry) => entry !== id) : [...current, id]))
                          }
                        />
                      </td>
                    ) : null}
                    {shown.map((column) => (
                      <td
                        key={column.id}
                        className={cn(
                          'border-b border-line/70 px-3 py-2 align-middle',
                          column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left',
                          PRIORITY_CLASS[column.priority ?? 1],
                          column.cellClassName,
                        )}
                      >
                        {column.cell(row)}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
