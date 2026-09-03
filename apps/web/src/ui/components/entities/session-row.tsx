import { useTranslation } from 'react-i18next'
import { Bot, User } from 'lucide-react'
import type { Session } from '../../../shared/task-types.ts'
import { Badge } from '../ui/badge.tsx'
import { useFormat } from '../../lib/use-format.ts'
import { taskHref } from '../../lib/tasks.ts'
import { cn } from '../../lib/utils.ts'

/** Who is working on what, since when, and what came out of it. */
export function SessionRow({
  session,
  showProject = false,
  actions,
  className,
}: {
  session: Session
  showProject?: boolean
  actions?: React.ReactNode
  className?: string
}) {
  const { t } = useTranslation('sessions')
  const { relativeTime, uptime } = useFormat()
  const Icon = session.actorKind === 'agent' ? Bot : User
  const now = Math.floor(Date.now() / 1000)
  const elapsed = (session.endedAt ?? now) - session.startedAt
  return (
    <div
      role="group"
      aria-label={t('rowLabel', { actor: session.actor })}
      className={cn('flex min-w-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2 text-sm last:border-b-0', className)}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden />
      <span className="font-medium text-ink">{session.agent ?? session.actor}</span>
      {session.agent && session.agent !== session.actor ? <span className="text-xs text-subtle">{session.actor}</span> : null}
      <Badge tone={session.status === 'active' ? 'ok' : session.status === 'abandoned' ? 'warn' : 'neutral'}>{t(`status.${session.status}`)}</Badge>
      {showProject ? (
        <a className="text-xs text-muted underline-offset-2 hover:text-accent hover:underline" href={`#/projects/${encodeURIComponent(session.project)}`}>
          {session.project}
        </a>
      ) : null}
      {session.task ? (
        <a className="min-w-0 truncate underline-offset-2 hover:text-accent hover:underline" href={taskHref(session.project, session.task.id)}>
          #{session.task.id} {session.task.title}
        </a>
      ) : (
        <span className="text-xs text-subtle">{t('noTask')}</span>
      )}
      {session.repository ? <Badge tone="outline">{session.repository.name}</Badge> : null}
      {session.environment ? (
        <a className="font-mono text-xs text-muted underline-offset-2 hover:text-accent hover:underline" href={`#/environments/${encodeURIComponent(session.environment)}`}>
          {session.environment}
        </a>
      ) : null}
      {session.commits.length > 0 ? <Badge tone="outline">{t('commits', { count: session.commits.length })}</Badge> : null}
      <span className="ml-auto text-[11px] text-subtle">
        {session.status === 'active'
          ? t('activeFor', { time: uptime(elapsed), last: relativeTime(session.lastActivityAt) })
          : t('endedAgo', { time: relativeTime(session.endedAt ?? session.lastActivityAt) })}
      </span>
      {actions}
    </div>
  )
}
