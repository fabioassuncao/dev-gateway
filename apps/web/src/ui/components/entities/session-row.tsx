import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, GitCommitHorizontal, User } from 'lucide-react'
import type { Session } from '../../../shared/task-types.ts'
import { Badge, StatusDot } from '../ui/badge.tsx'
import { Tooltip } from '../ui/tooltip.tsx'
import { useFormat } from '../../lib/use-format.ts'
import { taskHref } from '../../lib/tasks.ts'
import { cn } from '../../lib/utils.ts'

/**
 * Who is working on what, since when, and what has come out of it.
 *
 * Two lines rather than one wrapping row: the first is the identity of the
 * worker and the task, the second is the trail — repository, environment,
 * commits, how long. A dashboard column is narrow, and a session that wraps
 * into five lines of badges tells you less than one that does not.
 */
export function SessionRow({
  session,
  showProject = false,
  actions,
  className,
}: {
  session: Session
  showProject?: boolean
  actions?: ReactNode
  className?: string
}) {
  const { t } = useTranslation('sessions')
  const { relativeTime, uptime } = useFormat()
  const agent = session.actorKind === 'agent'
  const Icon = agent ? Bot : User
  const now = Math.floor(Date.now() / 1000)
  const elapsed = (session.endedAt ?? now) - session.startedAt
  const active = session.status === 'active'

  return (
    <div
      role="group"
      aria-label={t('rowLabel', { actor: session.actor })}
      className={cn('min-w-0 border-b border-line px-4 py-2 text-sm last:border-b-0', className)}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Icon className={cn('h-3.5 w-3.5 shrink-0', agent ? 'text-agent' : 'text-subtle')} aria-hidden />
        <span className="min-w-0 truncate font-medium text-ink">{session.agent ?? session.actor}</span>
        {session.agent && session.agent !== session.actor ? (
          <span className="hidden truncate text-xs text-subtle sm:inline">{session.actor}</span>
        ) : null}
        {active ? (
          <StatusDot tone={agent ? 'agent' : 'ok'} pulse label={t('status.active')} />
        ) : (
          <Badge tone={session.status === 'abandoned' ? 'warn' : 'neutral'}>{t(`status.${session.status}`)}</Badge>
        )}
        <Tooltip label={active ? t('duration', { time: uptime(elapsed) }) : t('endedAgo', { time: relativeTime(session.endedAt ?? session.lastActivityAt) })}>
          <span tabIndex={0} className="ml-auto shrink-0 rounded text-[11px] tabular-nums text-subtle outline-none focus-visible:outline-2 focus-visible:outline-accent">
            {active ? uptime(elapsed) : t('endedAgo', { time: relativeTime(session.endedAt ?? session.lastActivityAt) })}
          </span>
        </Tooltip>
        {actions}
      </div>

      {session.task ? (
        <a
          className="mt-0.5 block min-w-0 truncate text-[13px] text-ink underline-offset-2 hover:text-accent hover:underline"
          href={taskHref(session.project, session.task.id)}
        >
          <span className="font-mono text-xs text-subtle">#{session.task.id}</span> {session.task.title}
        </a>
      ) : (
        <p className="mt-0.5 text-xs text-subtle">{t('noTask')}</p>
      )}

      {session.summary ? <p className="mt-0.5 line-clamp-2 text-xs text-muted">{session.summary}</p> : null}

      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-subtle">
        {showProject ? (
          <a className="truncate underline-offset-2 hover:text-accent hover:underline" href={`#/projects/${encodeURIComponent(session.project)}`}>
            {session.project}
          </a>
        ) : null}
        {session.repository ? <Badge tone="outline">{session.repository.name}</Badge> : null}
        {session.environment ? (
          <a className="truncate font-mono underline-offset-2 hover:text-accent hover:underline" href={`#/environments/${encodeURIComponent(session.environment)}`}>
            {session.environment}
          </a>
        ) : null}
        {session.commits.length > 0 ? (
          <Tooltip label={session.commits.slice(0, 5).map((commit) => commit.subject).join(' · ')}>
            <span tabIndex={0} className="inline-flex items-center gap-1 rounded outline-none focus-visible:outline-2 focus-visible:outline-accent">
              <GitCommitHorizontal className="h-3 w-3" aria-hidden />
              {t('commits', { count: session.commits.length })}
            </span>
          </Tooltip>
        ) : null}
        {active ? <span className="ml-auto">{t('lastActivity', { time: relativeTime(session.lastActivityAt) })}</span> : null}
      </div>
    </div>
  )
}
