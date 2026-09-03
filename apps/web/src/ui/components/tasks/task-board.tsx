import { useEffect, useRef, useState } from 'react'
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
  onMove: (task: TaskSummary, status: TaskStatus) => void
  onOpen?: (task: TaskSummary) => void
  readOnly?: boolean
}) {
  const { t } = useTranslation('tasks')
  const defaultColumns = useBoardColumns()
  const columns = columnsProp ?? defaultColumns
  const [announcement, setAnnouncement] = useState('')

  function move(task: TaskSummary, status: TaskStatus): void {
    if (readOnly || task.status === status) return
    onMove(task, status)
    const column = columns.find((entry) => entry.status === status)
    setAnnouncement(t('movedAnnouncement', { id: task.id, column: column?.label ?? status }))
  }

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
  onMove: (task: TaskSummary, status: TaskStatus) => void
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
      getData: () => ({ columnId: column.id }),
      onDragEnter: () => setOver(true),
      onDragLeave: () => setOver(false),
      onDrop: ({ source }) => {
        setOver(false)
        const task = source.data['task'] as TaskSummary | undefined
        if (task) onMove(task, column.status)
      },
    })
  }, [column.id, column.status, onMove, readOnly])

  const shown = tasks.slice(0, COLUMN_CAP)

  return (
    <section
      ref={region}
      aria-label={t('columnLabel', { label: column.label })}
      className={cn('flex min-w-0 flex-col rounded-lg border border-line bg-surface', over && 'border-accent bg-accent/5')}
    >
      <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <h2 className="text-sm font-semibold text-ink">{column.label}</h2>
        <Badge tone="outline">{tasks.length}</Badge>
      </header>

      <div className="min-h-24 space-y-2 p-2">
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
