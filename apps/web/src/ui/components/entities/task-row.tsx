import { useTranslation } from 'react-i18next'
import type { TaskSummary } from '../../../shared/task-types.ts'
import { Badge } from '../ui/badge.tsx'
import { useFormat } from '../../lib/use-format.ts'
import { cn } from '../../lib/utils.ts'
import { TaskGitHubBadge, TaskPriorityBadge, TaskStatusBadge, TaskWorker } from './task-badges.tsx'

/**
 * One task in a list. `depth` indents a subtask under its parent; `compact`
 * drops the trailing detail for a dashboard column.
 */
export function TaskRow({
  task,
  href,
  depth = 0,
  compact = false,
  showProject = false,
  actions,
  className,
}: {
  task: TaskSummary
  href: string
  depth?: number
  compact?: boolean
  showProject?: boolean
  actions?: React.ReactNode
  className?: string
}) {
  const { t } = useTranslation('tasks')
  const { relativeTime } = useFormat()
  return (
    <div
      role="group"
      aria-label={`#${task.id} ${task.title}`}
      className={cn('flex min-w-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2 text-sm last:border-b-0', className)}
      style={{ paddingLeft: `${16 + depth * 20}px` }}
    >
      <a className="font-mono text-xs text-subtle underline-offset-2 hover:text-accent hover:underline" href={href}>
        #{task.id}
      </a>
      <a className="min-w-0 truncate font-medium text-ink underline-offset-2 hover:text-accent hover:underline" href={href}>
        {task.title}
      </a>
      {showProject ? <Badge tone="outline">{task.project}</Badge> : null}
      {task.repository ? <Badge tone="outline">{task.repository.name}</Badge> : null}
      {task.type ? <Badge tone="neutral">{task.type}</Badge> : null}
      <TaskStatusBadge status={task.status} />
      <TaskPriorityBadge priority={task.priority} />
      {!compact && task.subtaskCount > 0 ? (
        <Badge tone="outline">{t('subtasksCount', { done: task.subtaskCount - task.openSubtaskCount, total: task.subtaskCount })}</Badge>
      ) : null}
      <TaskWorker task={task} />
      <TaskGitHubBadge github={task.github} compact={compact} />
      {!compact ? (
        <span className="ml-auto text-[11px] text-subtle">{t('updatedAgo', { time: relativeTime(task.updatedAt) })}</span>
      ) : null}
      {actions}
    </div>
  )
}
