import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import type { TaskStatus, TaskSummary } from '../../../shared/task-types.ts'
import { Badge } from '../ui/badge.tsx'
import { Empty } from '../shell-bits.tsx'
import { cn } from '../../lib/utils.ts'
import { useBoardColumns, type BoardColumn } from '../../i18n/use-task-statuses.ts'
import { columnFor } from '../../lib/task-presentation.ts'
import { taskHref } from '../../lib/tasks.ts'
import { TaskCard } from '../entities/task-card.tsx'

/** A long column is capped rather than left to render two hundred rows. */
const COLUMN_CAP = 60

export function planBoardMove(
  tasks: TaskSummary[],
  task: TaskSummary,
  status: TaskStatus,
  targetId?: string,
  edge?: 'before' | 'after',
): { beforeId: string | null; afterId: string | null } | null {
  const destination = tasks.filter((entry) => entry.status === status && entry.id !== task.id).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
  let index = destination.length
  if (targetId) {
    const targetIndex = destination.findIndex((entry) => entry.id === targetId)
    if (targetIndex >= 0) index = targetIndex + (edge === 'after' ? 1 : 0)
  }
  const resultingIds = destination.map((entry) => entry.id)
  resultingIds.splice(index, 0, task.id)
  const originalIds = tasks.filter((entry) => entry.status === status).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)).map((entry) => entry.id)
  if (task.status === status && resultingIds.join('\0') === originalIds.join('\0')) return null
  return { beforeId: destination[index - 1]?.id ?? null, afterId: destination[index]?.id ?? null }
}

export function TaskBoard({
  slug,
  tasks,
  columns: columnsProp,
  onMove,
  onOpen,
  readOnly = false,
}: {
  slug: string
  tasks: TaskSummary[]
  columns?: BoardColumn[]
  onMove: (task: TaskSummary, status: TaskStatus, beforeId: string | null, afterId: string | null) => void
  onOpen?: (task: TaskSummary) => void
  readOnly?: boolean
}) {
  const { t } = useTranslation('tasks')
  const defaultColumns = useBoardColumns()
  const columns = columnsProp ?? defaultColumns
  const [announcement, setAnnouncement] = useState('')

  const move = useCallback((task: TaskSummary, status: TaskStatus, targetId?: string, edge?: 'before' | 'after'): void => {
    if (readOnly) return
    const planned = planBoardMove(tasks, task, status, targetId, edge)
    if (!planned) return
    onMove(task, status, planned.beforeId, planned.afterId)
    const column = columns.find((entry) => entry.status === status)
    setAnnouncement(t('movedAnnouncement', { id: task.id, column: column?.label ?? status }))
  }, [columns, onMove, readOnly, t, tasks])

  return (
    <>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {columns.map((column) => (
          <BoardColumnView
            key={column.id}
            slug={slug}
            column={column}
            tasks={tasks.filter((task) => columnFor(task, columns).id === column.id)}
            columns={columns}
            onMove={move}
            onOpen={onOpen}
            readOnly={readOnly}
          />
        ))}
      </div>
    </>
  )
}

function BoardColumnView({
  slug,
  column,
  tasks,
  columns,
  onMove,
  onOpen,
  readOnly,
}: {
  slug: string
  column: BoardColumn
  tasks: TaskSummary[]
  columns: BoardColumn[]
  onMove: (task: TaskSummary, status: TaskStatus, targetId?: string, edge?: 'before' | 'after') => void
  onOpen?: (task: TaskSummary) => void
  readOnly: boolean
}) {
  const { t } = useTranslation('tasks')
  const region = useRef<HTMLDivElement>(null)
  const [over, setOver] = useState(false)

  useEffect(() => {
    const element = region.current
    if (element === null || readOnly) return
    return dropTargetForElements({
      element,
      getData: () => ({ type: 'task-column', columnId: column.id }),
      onDragEnter: () => setOver(true),
      onDragLeave: () => setOver(false),
      onDrop: ({ source, location }) => {
        setOver(false)
        if (location.current.dropTargets[0]?.data['type'] === 'task-card') return
        const task = source.data['task'] as TaskSummary | undefined
        if (task) onMove(task, column.status)
      },
    })
  }, [column.id, column.status, onMove, readOnly])

  const shown = [...tasks].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)).slice(0, COLUMN_CAP)

  return (
    <section
      ref={region}
      aria-label={t('columnLabel', { label: column.label })}
      className={cn('flex min-h-0 min-w-0 flex-col rounded-lg border border-line bg-surface', over && 'border-accent/60 bg-accent/[0.04]')}
    >
      <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <h2 className="text-sm font-semibold text-ink">{column.label}</h2>
        <Badge tone="outline">{tasks.length}</Badge>
      </header>

      <div className="min-h-24 max-h-[min(70vh,40rem)] space-y-2 overflow-y-auto p-2">
        {shown.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-subtle">{t('nothingHere')}</p>
        ) : (
          shown.map((task) => (
            <TaskCard key={task.id} task={task} columns={columns} href={taskHref(slug, task.id)} onMove={onMove} onOpen={onOpen} readOnly={readOnly} />
          ))
        )}
        {tasks.length > shown.length ? (
          <p className="px-1 pb-1 text-center text-[11px] text-subtle">{t('moreHidden', { count: tasks.length - shown.length })}</p>
        ) : null}
      </div>
    </section>
  )
}

export function BoardEmpty() {
  const { t } = useTranslation('tasks')
  return <Empty title={t('emptyFilters')} hint={t('emptyFiltersHint')} />
}
