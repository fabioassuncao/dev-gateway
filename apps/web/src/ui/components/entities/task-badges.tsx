import { useTranslation } from 'react-i18next'
import { Bot, GitPullRequestArrow, User } from 'lucide-react'
import type { TaskPriority, TaskStatus, TaskSummary } from '../../../shared/task-types.ts'
import { Badge } from '../ui/badge.tsx'
import { Tooltip } from '../ui/tooltip.tsx'
import { useTaskStatuses } from '../../i18n/use-task-statuses.ts'
import {
  labelHue,
  priorityIcon,
  priorityTone,
  statusIcon,
  statusTone,
  syncTone,
  typeIcon,
  typeTone,
} from '../../lib/task-presentation.ts'
import { taskWorker } from '../../lib/tasks.ts'
import { cn } from '../../lib/utils.ts'

/**
 * The one way a task's status is drawn. Board card, table row, detail page and
 * dashboard all render this, so a status cannot be amber in one place and grey
 * in another.
 */
export function TaskStatusBadge({
  status,
  source,
  className,
}: {
  status: TaskStatus
  source?: 'fields' | 'labels' | 'none' | null
  className?: string
}) {
  const { statusLabel } = useTaskStatuses()
  const { t } = useTranslation('tasks')
  const Icon = statusIcon(status)
  return (
    <Badge tone={statusTone(status)} title={source === 'labels' ? t('status.fromLabel') : undefined} className={className}>
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      {statusLabel(status)}
      {source === 'labels' ? ' ·' : ''}
    </Badge>
  )
}

export function TaskPriorityBadge({ priority, className }: { priority: TaskPriority | null; className?: string }) {
  const { priorityLabel } = useTaskStatuses()
  if (!priority) return null
  const Icon = priorityIcon(priority)
  return (
    <Badge tone={priorityTone(priority)} className={className}>
      {Icon ? <Icon className="h-3 w-3 shrink-0" aria-hidden /> : null}
      {priorityLabel(priority)}
    </Badge>
  )
}

/**
 * What kind of work this is. The value stays whatever was stored — a task
 * typed "spike" still says "spike" — but a value the vocabulary recognises
 * gets that kind's colour and icon wherever it appears.
 */
export function TaskTypeBadge({ type, className }: { type: string | null; className?: string }) {
  if (!type) return null
  const Icon = typeIcon(type)
  return (
    <Badge tone={typeTone(type)} className={className}>
      {Icon ? <Icon className="h-3 w-3 shrink-0" aria-hidden /> : null}
      {type}
    </Badge>
  )
}

/**
 * Labels, coloured from their own names so the same label is the same colour
 * in every list. Beyond `max` they collapse into a count rather than wrapping
 * a row into three lines.
 */
export function TaskLabels({ labels, max = 3, className }: { labels: readonly string[]; max?: number; className?: string }) {
  if (labels.length === 0) return null
  const shown = labels.slice(0, max)
  const rest = labels.slice(max)
  return (
    <span className={cn('inline-flex min-w-0 flex-wrap items-center gap-1', className)}>
      {shown.map((label) => (
        <span
          key={label}
          className="inline-flex max-w-[10rem] items-center gap-1 truncate rounded border px-1.5 py-0.5 text-[11px] leading-none"
          style={{
            borderColor: `oklch(0.7 0.09 ${labelHue(label)} / 0.5)`,
            backgroundColor: `oklch(0.7 0.09 ${labelHue(label)} / 0.12)`,
          }}
        >
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: `oklch(0.62 0.13 ${labelHue(label)})` }} />
          {label}
        </span>
      ))}
      {rest.length > 0 ? (
        <Tooltip label={rest.join(', ')}>
          <span tabIndex={0} className="rounded text-[11px] text-subtle outline-none focus-visible:outline-2 focus-visible:outline-accent">
            +{rest.length}
          </span>
        </Tooltip>
      ) : null}
    </span>
  )
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
      <GitPullRequestArrow className="h-3 w-3" aria-hidden />
      <span className="font-mono">{compact ? `#${github.number}` : `${github.repository}#${github.number}`}</span>
      {github.syncState !== 'synced' ? <Badge tone={syncTone(github.syncState)}>{t(`sync.${github.syncState}`)}</Badge> : null}
    </a>
  )
}

/** Who is on it: an agent in the agent colour, a person in neutral. */
export function TaskWorker({ task, className }: { task: Pick<TaskSummary, 'assignee' | 'agent'>; className?: string }) {
  const worker = taskWorker(task)
  const { t } = useTranslation('tasks')
  if (!worker) return null
  const agent = worker.kind === 'agent'
  const Icon = agent ? Bot : User
  return (
    <span
      className={cn(
        'inline-flex max-w-[9rem] items-center gap-1 truncate text-[11px]',
        agent ? 'text-agent' : 'text-subtle',
        className,
      )}
      title={`${t(agent ? 'worker.agent' : 'worker.assignee')}: ${worker.name}`}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      {worker.name}
    </span>
  )
}
