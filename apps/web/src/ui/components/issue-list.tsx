import { useTranslation } from 'react-i18next'
import type { Issue } from '../../shared/types.ts'
import { Badge } from './ui/badge.tsx'
import { Empty } from './shell-bits.tsx'
import { useFormat } from '../lib/use-format.ts'
import { useIssueStatuses } from '../i18n/use-issue-statuses.ts'

const PRIORITY_TONE: Record<NonNullable<Issue['priority']>, 'neutral' | 'warn' | 'danger'> = {
  low: 'neutral',
  medium: 'neutral',
  high: 'warn',
  urgent: 'danger',
}

export function nest(issues: Issue[]): { issue: Issue; depth: number }[] {
  const byId = new Map(issues.map((issue) => [issue.id, issue]))
  const roots = issues.filter((issue) => issue.parentId === null || !byId.has(issue.parentId))
  const rows: { issue: Issue; depth: number }[] = []

  const walk = (issue: Issue, depth: number, seen: Set<string>) => {
    if (seen.has(issue.id)) return
    seen.add(issue.id)
    rows.push({ issue, depth })
    for (const childId of issue.childIds) {
      const child = byId.get(childId)
      if (child && depth < 4) walk(child, depth + 1, seen)
    }
  }

  const seen = new Set<string>()
  for (const root of roots) walk(root, 0, seen)
  for (const issue of issues) if (!seen.has(issue.id)) rows.push({ issue, depth: 0 })
  return rows
}

export function IssueRows({
  issues,
  onSelect,
}: {
  issues: Issue[]
  onSelect?: (issue: Issue) => void
}) {
  const { t } = useTranslation('issues')
  const { statusLabel } = useIssueStatuses()
  const { relativeTime } = useFormat()

  if (issues.length === 0) {
    return (
      <Empty
        title={t('emptyRow', { defaultValue: 'No issue matches' })}
        hint={t('emptyRowHint', {
          defaultValue:
            "Issues are read from the panel's projection. Press Sync under Settings → GitHub if it looks empty.",
        })}
      />
    )
  }

  return (
    <div>
      {nest(issues).map(({ issue, depth }) => (
        <div
          key={issue.id}
          role="group"
          aria-label={`${issue.repository}#${issue.number}`}
          className="flex min-w-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2 text-sm last:border-b-0"
          style={{ paddingLeft: `${16 + depth * 20}px` }}
        >
          <Badge tone="outline">{issue.repository.split('/')[1] ?? issue.repository}</Badge>
          <a
            className="font-mono text-xs text-subtle underline-offset-2 hover:text-accent hover:underline"
            href={issue.htmlUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            #{issue.number}
          </a>
          {onSelect ? (
            <button className="min-w-0 truncate text-left hover:text-accent" onClick={() => onSelect(issue)}>
              {issue.title}
            </button>
          ) : (
            <span className="min-w-0 truncate">{issue.title}</span>
          )}
          {issue.issueType ? <Badge tone="neutral">{issue.issueType}</Badge> : null}
          {issue.status ? (
            <Badge
              tone={issue.status === 'blocked' ? 'danger' : issue.status === 'done' ? 'ok' : 'accent'}
              title={
                issue.metadataSource === 'labels'
                  ? t('statusFromLabelTitle', { defaultValue: 'from the status: label convention' })
                  : t('statusFromFieldTitle', { defaultValue: 'from a native GitHub field' })
              }
            >
              {statusLabel(issue.status)}
              {issue.metadataSource === 'labels' ? ' ·' : ''}
            </Badge>
          ) : null}
          {issue.priority ? (
            <Badge tone={PRIORITY_TONE[issue.priority]}>
              {t('priorityBadge', { defaultValue: 'priority: {{priority}}', priority: issue.priority })}
            </Badge>
          ) : null}
          {issue.childIds.length > 0 ? (
            <Badge tone="outline">
              {t('subIssues', {
                defaultValue: '{{count}} sub-{{word}}',
                count: issue.childIds.length,
                word: issue.childIds.length === 1 ? 'issue' : 'issues',
              })}
            </Badge>
          ) : null}
          {issue.state === 'closed' ? <Badge tone="neutral">{t('state.closed')}</Badge> : null}
          <span className="ml-auto text-[11px] text-subtle">
            {issue.stale
              ? t('syncedAgo', {
                  defaultValue: 'synced {{time}}',
                  time: relativeTime(issue.syncedAt),
                })
              : t('updatedAgo', {
                  defaultValue: 'updated {{time}}',
                  time: relativeTime(issue.githubUpdatedAt),
                })}
          </span>
        </div>
      ))}
    </div>
  )
}
