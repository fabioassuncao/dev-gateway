import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TaskSummary } from '../../../shared/task-types.ts'
import { Badge } from '../ui/badge.tsx'
import { Tooltip } from '../ui/tooltip.tsx'
import { useFormat } from '../../lib/use-format.ts'
import { cn } from '../../lib/utils.ts'
import { TaskGitHubBadge, TaskPriorityBadge, TaskStatusBadge, TaskTypeBadge, TaskWorker } from './task-badges.tsx'

/**
 * One task in a list.
 *
 * The row has one job: let the eye find the right task and open it. So the
 * title owns the width and everything else is pushed to the trailing edge in a
 * fixed order — who is on it, what state it is in, how long since it moved —
 * which is what makes a column of these scannable rather than a wall of
 * badges. `depth` indents a subtask under its parent; `compact` drops the
 * detail a dashboard column has no room for.
 */
export function TaskRow({
  task,
  href,
  depth = 0,
  compact = false,
  showProject = false,
  /** How long since it last moved. On a dashboard this is the whole point. */
  showAge = false,
  actions,
  className,
}: {
  task: TaskSummary
  href: string
  depth?: number
  compact?: boolean
  showProject?: boolean
  showAge?: boolean
  actions?: ReactNode
  className?: string
}) {
  const { t } = useTranslation('tasks')
  const { relativeTime } = useFormat()
  return (
    <div
      role="group"
      aria-label={`#${task.id} ${task.title}`}
      className={cn('group flex min-w-0 items-center gap-2 border-b border-line px-4 py-1.5 text-sm last:border-b-0', className)}
      style={{ paddingLeft: `${16 + depth * 20}px` }}
    >
      <a
        className="w-12 shrink-0 truncate font-mono text-xs text-subtle underline-offset-2 hover:text-accent hover:underline"
        href={href}
      >
        #{task.id}
      </a>
      <a className="min-w-0 flex-1 truncate font-medium text-ink underline-offset-2 hover:text-accent hover:underline" href={href}>
        {task.title}
      </a>

      <div className="flex shrink-0 items-center gap-1.5">
        {showProject ? (
          <a
            className="hidden max-w-[8rem] truncate text-[11px] text-muted underline-offset-2 hover:text-accent hover:underline sm:inline"
            href={`#/projects/${encodeURIComponent(task.project)}`}
          >
            {task.project}
          </a>
        ) : null}
        {task.repository ? <Badge tone="outline" className="hidden lg:inline-flex">{task.repository.name}</Badge> : null}
        <TaskTypeBadge type={task.type} className="hidden xl:inline-flex" />
        {!compact && task.subtaskCount > 0 ? (
          <Badge tone="outline" className="hidden lg:inline-flex">
            {t('subtasksCount', { done: task.subtaskCount - task.openSubtaskCount, total: task.subtaskCount })}
          </Badge>
        ) : null}
        <TaskWorker task={task} />
        <TaskGitHubBadge github={task.github} compact />
        <TaskPriorityBadge priority={task.priority} />
        <TaskStatusBadge status={task.status} />
        {showAge || !compact ? (
          <Tooltip label={t('updatedAgo', { time: relativeTime(task.updatedAt) })}>
            <span tabIndex={0} className="hidden w-14 shrink-0 text-right text-[11px] tabular-nums text-subtle outline-none sm:inline focus-visible:outline-2 focus-visible:outline-accent">
              {relativeTime(task.updatedAt)}
            </span>
          </Tooltip>
        ) : null}
        {actions}
      </div>
    </div>
  )
}
