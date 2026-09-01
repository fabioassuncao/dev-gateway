import type { Issue } from '../../shared/types.ts'
import { Badge } from './ui/badge.tsx'
import { Empty } from './shell-bits.tsx'
import { relativeTime } from '../lib/format.ts'

const STATUS_LABEL: Record<NonNullable<Issue['status']>, string> = {
  backlog: 'Backlog',
  ready: 'Ready',
  in_progress: 'In Progress',
  review: 'Review',
  blocked: 'Blocked',
  done: 'Done',
}

const PRIORITY_TONE: Record<NonNullable<Issue['priority']>, 'neutral' | 'warn' | 'danger'> = {
  low: 'neutral',
  medium: 'neutral',
  high: 'warn',
  urgent: 'danger',
}

/** Sub-issues nested under their parent; an orphan keeps its place at the top. */
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
      // A depth cap is belt and braces: the sync refuses cycles already.
      if (child && depth < 4) walk(child, depth + 1, seen)
    }
  }

  const seen = new Set<string>()
  for (const root of roots) walk(root, 0, seen)
  // Anything a cycle would have hidden is still listed, flat.
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
  if (issues.length === 0) {
    return (
      <Empty
        title="No issue matches"
        hint="Issues are read from the panel's projection. Press Sync under Settings → GitHub if it looks empty."
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
              // The origin of a status changes what a write will do, so it is
              // visible on hover rather than hidden.
              title={
                issue.metadataSource === 'labels'
                  ? 'from the status: label convention'
                  : 'from a native GitHub field'
              }
            >
              {STATUS_LABEL[issue.status]}
              {issue.metadataSource === 'labels' ? ' ·' : ''}
            </Badge>
          ) : null}
          {issue.priority ? (
            <Badge tone={PRIORITY_TONE[issue.priority]}>priority: {issue.priority}</Badge>
          ) : null}
          {issue.childIds.length > 0 ? (
            <Badge tone="outline">
              {issue.childIds.length} sub-{issue.childIds.length === 1 ? 'issue' : 'issues'}
            </Badge>
          ) : null}
          {issue.state === 'closed' ? <Badge tone="neutral">closed</Badge> : null}
          <span className="ml-auto text-[11px] text-subtle">
            {issue.stale ? `synced ${relativeTime(issue.syncedAt)}` : `updated ${relativeTime(issue.githubUpdatedAt)}`}
          </span>
        </div>
      ))}
    </div>
  )
}
