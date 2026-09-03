import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { AlertTriangle, MoreHorizontal } from 'lucide-react'
import type { TaskStatus, TaskSummary } from '../../../shared/task-types.ts'
import { Badge } from '../ui/badge.tsx'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../ui/menu.tsx'
import { cn } from '../../lib/utils.ts'
import type { BoardColumn } from '../../i18n/use-task-statuses.ts'
import { TaskGitHubBadge, TaskPriorityBadge, TaskWorker } from './task-badges.tsx'

/** One card on the board: draggable, and movable from its menu for the keyboard. */
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
  onMove: (task: TaskSummary, status: TaskStatus) => void
  onOpen?: (task: TaskSummary) => void
  readOnly?: boolean
}) {
  const { t } = useTranslation('tasks')
  const { t: tc } = useTranslation('common')
  const element = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const node = element.current
    if (node === null || readOnly) return
    return draggable({
      element: node,
      getInitialData: () => ({ task }),
      onDragStart: () => setDragging(true),
      onDrop: () => setDragging(false),
    })
  }, [task, readOnly])

  return (
    <div
      ref={element}
      role="article"
      aria-label={`#${task.id} ${task.title}`}
      tabIndex={0}
      className={cn(
        'rounded-md border border-line bg-surface-2/40 px-2.5 py-2 text-sm outline-none',
        'focus-visible:border-accent',
        dragging && 'opacity-50',
      )}
    >
      <div className="flex min-w-0 items-start gap-1.5">
        <a className="font-mono text-[11px] text-subtle underline-offset-2 hover:text-accent hover:underline" href={href}>
          #{task.id}
        </a>
        {task.repository ? <Badge tone="outline">{task.repository.name}</Badge> : null}
        {task.type ? <Badge tone="neutral">{task.type}</Badge> : null}
        {task.github?.syncState === 'conflict' ? (
          <AlertTriangle className="h-3.5 w-3.5 text-danger" aria-label={t('sync.conflict')} />
        ) : null}
        <Menu>
          <MenuTrigger
            aria-label={t('actionsFor', { id: task.id })}
            className="ml-auto rounded p-0.5 text-subtle hover:bg-surface-2 hover:text-ink"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </MenuTrigger>
          <MenuContent>
            <MenuItem onSelect={() => (onOpen ? onOpen(task) : (window.location.hash = href.replace(/^#/, '')))}>{tc('open')}</MenuItem>
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

      <a href={href} className="mt-1 block line-clamp-2 text-[13px] leading-snug text-ink hover:text-accent">
        {task.title}
      </a>

      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-subtle">
        <TaskPriorityBadge priority={task.priority} />
        {task.subtaskCount > 0 ? (
          <span>{t('subtasksCount', { done: task.subtaskCount - task.openSubtaskCount, total: task.subtaskCount })}</span>
        ) : null}
        <TaskWorker task={task} />
        <TaskGitHubBadge github={task.github} compact />
      </div>
    </div>
  )
}
