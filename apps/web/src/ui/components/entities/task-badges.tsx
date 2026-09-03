import { useTranslation } from 'react-i18next'
import { Bot, GitBranch, User } from 'lucide-react'
import type { TaskPriority, TaskStatus, TaskSummary } from '../../../shared/task-types.ts'
import { Badge } from '../ui/badge.tsx'
import { useTaskStatuses } from '../../i18n/use-task-statuses.ts'
import { priorityTone, statusTone, syncTone } from '../../lib/task-presentation.ts'
import { taskWorker } from '../../lib/tasks.ts'

export function TaskStatusBadge({ status, source }: { status: TaskStatus; source?: 'fields' | 'labels' | 'none' | null }) {
  const { statusLabel } = useTaskStatuses()
  const { t } = useTranslation('tasks')
  return (
    <Badge tone={statusTone(status)} title={source === 'labels' ? t('status.fromLabel') : undefined}>
      {statusLabel(status)}
      {source === 'labels' ? ' ·' : ''}
    </Badge>
  )
}

export function TaskPriorityBadge({ priority }: { priority: TaskPriority | null }) {
  const { priorityLabel } = useTaskStatuses()
  if (!priority) return null
  return <Badge tone={priorityTone(priority)}>{priorityLabel(priority)}</Badge>
}

/** The GitHub issue a task is bound to, with the state of the binding. */
export function TaskGitHubBadge({ github, compact = false }: { github: TaskSummary['github']; compact?: boolean }) {
  const { t } = useTranslation('tasks')
  if (!github) return null
  return (
    <a
      className="inline-flex items-center gap-1 text-[11px] text-muted underline-offset-2 hover:text-accent hover:underline"
      href={github.htmlUrl}
      target="_blank"
      rel="noreferrer noopener"
      title={t(`sync.${github.syncState}`)}
    >
      <GitBranch className="h-3 w-3" aria-hidden />
      <span className="font-mono">{compact ? `#${github.number}` : `${github.repository}#${github.number}`}</span>
      {github.syncState !== 'synced' ? <Badge tone={syncTone(github.syncState)}>{t(`sync.${github.syncState}`)}</Badge> : null}
    </a>
  )
}

/** Who is on it: an agent with a bot icon, a person with a person icon. */
export function TaskWorker({ task, className }: { task: Pick<TaskSummary, 'assignee' | 'agent'>; className?: string }) {
  const worker = taskWorker(task)
  const { t } = useTranslation('tasks')
  if (!worker) return null
  const Icon = worker.kind === 'agent' ? Bot : User
  return (
    <span className={className ?? 'inline-flex items-center gap-1 text-[11px] text-subtle'} title={t(worker.kind === 'agent' ? 'worker.agent' : 'worker.assignee')}>
      <Icon className="h-3 w-3" aria-hidden />
      {worker.name}
    </span>
  )
}
