import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import { AlertTriangle, GripVertical, MoreHorizontal } from 'lucide-react'
import type { TaskStatus, TaskSummary } from '../../../shared/task-types.ts'
import { Badge } from '../ui/badge.tsx'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '../ui/menu.tsx'
import { cn } from '../../lib/utils.ts'
import { priorityTone } from '../../lib/task-presentation.ts'
import type { BoardColumn } from '../../i18n/use-task-statuses.ts'
import { TaskGitHubBadge, TaskLabels, TaskPriorityBadge, TaskTypeBadge, TaskWorker } from './task-badges.tsx'

const PRIORITY_EDGE: Record<string, string> = {
  danger: 'before:bg-danger',
  warn: 'before:bg-warn',
  info: 'before:bg-info',
  neutral: 'before:bg-transparent',
}

/**
 * One card on the board.
 *
 * Draggable by pointer and movable from its menu, so the board is not a
 * mouse-only feature. Priority is a stripe down the left edge rather than a
 * fifth badge: on a column of twenty cards the urgent ones have to be findable
 * without reading any of them.
 */
export function TaskCard({
  task,
  columns,
  href,
  onMove,
  onOpen,
  readOnly = false,
}: {
  task: TaskSummary
  columns: BoardColumn[]
  href: string
  onMove: (task: TaskSummary, status: TaskStatus, targetId?: string, edge?: 'before' | 'after') => void
  onOpen?: (task: TaskSummary) => void
  readOnly?: boolean
}) {
  const { t } = useTranslation('tasks')
  const { t: tc } = useTranslation('common')
  const element = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [closestEdge, setClosestEdge] = useState<'before' | 'after' | null>(null)

  useEffect(() => {
    const node = element.current
    if (node === null || readOnly) return
    return combine(
      draggable({
        element: node,
        getInitialData: () => ({ task }),
        onDragStart: () => setDragging(true),
        onDrop: () => setDragging(false),
      }),
      dropTargetForElements({
        element: node,
        canDrop: ({ source }) => (source.data['task'] as TaskSummary | undefined)?.id !== task.id,
        getData: ({ input, element }) => ({
          type: 'task-card', taskId: task.id,
          edge: input.clientY < element.getBoundingClientRect().top + element.getBoundingClientRect().height / 2 ? 'before' : 'after',
        }),
        onDrag: ({ self }) => setClosestEdge(self.data['edge'] as 'before' | 'after'),
        onDragLeave: () => setClosestEdge(null),
        onDrop: ({ source, self }) => {
          setClosestEdge(null)
          const dragged = source.data['task'] as TaskSummary | undefined
          if (dragged) onMove(dragged, task.status, task.id, self.data['edge'] as 'before' | 'after')
        },
      }),
    )
  }, [task, readOnly, onMove])

  const stripe = PRIORITY_EDGE[priorityTone(task.priority)] ?? PRIORITY_EDGE.neutral

  return (
    <div
      ref={element}
      role="article"
      aria-label={`#${task.id} ${task.title}`}
      tabIndex={0}
      className={cn(
        'group relative rounded-md border border-line bg-surface px-2.5 py-2 text-sm shadow-raised outline-none',
        'transition-shadow focus-visible:border-accent',
        // The priority stripe, drawn on the card's own left edge.
        task.priority ? cn('before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full', stripe) : null,
        !readOnly && 'cursor-grab active:cursor-grabbing',
        dragging && 'opacity-50 ring-1 ring-accent/50',
        closestEdge === 'before' && 'after:pointer-events-none after:absolute after:inset-x-0 after:-top-1 after:h-0.5 after:rounded-full after:bg-accent',
        closestEdge === 'after' && 'after:pointer-events-none after:absolute after:inset-x-0 after:-bottom-1 after:h-0.5 after:rounded-full after:bg-accent',
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {!readOnly ? (
          <GripVertical className="h-3 w-3 shrink-0 text-subtle opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
        ) : null}
        <a className="font-mono text-[11px] text-subtle underline-offset-2 hover:text-accent hover:underline" href={href}>
          #{task.id}
        </a>
        {task.github?.syncState === 'conflict' ? (
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-danger" aria-label={t('sync.conflict')} />
        ) : null}
        <Menu>
          <MenuTrigger
            aria-label={t('actionsFor', { id: task.id })}
            className="ml-auto rounded p-0.5 text-subtle opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-surface-2 hover:text-ink data-[state=open]:opacity-100"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </MenuTrigger>
          <MenuContent>
            <MenuItem onSelect={() => (onOpen ? onOpen(task) : (window.location.hash = href.replace(/^#/, '')))}>{tc('open')}</MenuItem>
            <MenuSeparator />
            <MenuLabel>{t('table.status')}</MenuLabel>
            {columns.map((column) => (
              <MenuItem
                key={column.id}
                disabled={readOnly || task.status === column.status}
                onSelect={() => onMove(task, column.status)}
              >
                {t('moveTo', { label: column.label })}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
      </div>

      <a href={href} className="mt-1 block line-clamp-3 text-[13px] leading-snug text-ink hover:text-accent">
        {task.title}
      </a>

      {task.labels.length > 0 ? <TaskLabels labels={task.labels} max={2} className="mt-1.5" /> : null}

      <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-subtle">
        <TaskPriorityBadge priority={task.priority} />
        <TaskTypeBadge type={task.type} />
        {task.repository ? <Badge tone="outline">{task.repository.name}</Badge> : null}
        {task.subtaskCount > 0 ? (
          <span className="tabular-nums">{t('subtasksCount', { done: task.subtaskCount - task.openSubtaskCount, total: task.subtaskCount })}</span>
        ) : null}
        <span className="ml-auto flex items-center gap-1.5">
          <TaskWorker task={task} />
          <TaskGitHubBadge github={task.github} compact />
        </span>
      </div>
    </div>
  )
}
