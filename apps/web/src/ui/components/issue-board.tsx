import { useEffect, useRef, useState } from 'react'
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { MoreHorizontal } from 'lucide-react'
import type { Issue, WorkflowStatus } from '../../shared/types.ts'
import { Badge } from './ui/badge.tsx'
import { Menu, MenuContent, MenuItem, MenuTrigger } from './ui/menu.tsx'
import { Empty } from './shell-bits.tsx'
import { cn } from '../lib/utils.ts'

export interface BoardColumn {
  id: string
  label: string
  status: WorkflowStatus
}

/** The six statuses `WorkflowStatus` defines, as data rather than as code. */
export const DEFAULT_COLUMNS: BoardColumn[] = [
  { id: 'backlog', label: 'Backlog', status: 'backlog' },
  { id: 'ready', label: 'Ready', status: 'ready' },
  { id: 'in_progress', label: 'In Progress', status: 'in_progress' },
  { id: 'review', label: 'Review', status: 'review' },
  { id: 'blocked', label: 'Blocked', status: 'blocked' },
  { id: 'done', label: 'Done', status: 'done' },
]

/** A long column is capped rather than left to render two hundred rows. */
const COLUMN_CAP = 60

const PRIORITY_TONE: Record<NonNullable<Issue['priority']>, 'neutral' | 'warn' | 'danger'> = {
  low: 'neutral',
  medium: 'neutral',
  high: 'warn',
  urgent: 'danger',
}

export function columnFor(issue: Issue, columns: BoardColumn[]): BoardColumn {
  return columns.find((column) => column.status === issue.status) ?? columns[0]!
}

export function IssueBoard({
  issues,
  columns = DEFAULT_COLUMNS,
  onMove,
  onOpen,
  readOnly = false,
}: {
  issues: Issue[]
  columns?: BoardColumn[]
  onMove: (issue: Issue, status: WorkflowStatus) => void
  onOpen?: (issue: Issue) => void
  readOnly?: boolean
}) {
  // A move announces its result, because a card that silently jumped columns is
  // not a result anyone using a screen reader can perceive.
  const [announcement, setAnnouncement] = useState('')

  function move(issue: Issue, status: WorkflowStatus): void {
    if (readOnly || issue.status === status) return
    onMove(issue, status)
    const column = columns.find((entry) => entry.status === status)
    setAnnouncement(`${issue.repository}#${issue.number} moved to ${column?.label ?? status}`)
  }

  return (
    <>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {columns.map((column) => (
          <BoardColumnView
            key={column.id}
            column={column}
            issues={issues.filter((issue) => columnFor(issue, columns).id === column.id)}
            columns={columns}
            onMove={move}
            onOpen={onOpen}
            readOnly={readOnly}
          />
        ))}
      </div>
    </>
  )
}

function BoardColumnView({
  column,
  issues,
  columns,
  onMove,
  onOpen,
  readOnly,
}: {
  column: BoardColumn
  issues: Issue[]
  columns: BoardColumn[]
  onMove: (issue: Issue, status: WorkflowStatus) => void
  onOpen?: (issue: Issue) => void
  readOnly: boolean
}) {
  const region = useRef<HTMLDivElement>(null)
  const [over, setOver] = useState(false)

  useEffect(() => {
    const element = region.current
    if (element === null || readOnly) return
    return dropTargetForElements({
      element,
      getData: () => ({ columnId: column.id }),
      onDragEnter: () => setOver(true),
      onDragLeave: () => setOver(false),
      onDrop: ({ source }) => {
        setOver(false)
        const issue = source.data['issue'] as Issue | undefined
        if (issue) onMove(issue, column.status)
      },
    })
  }, [column.id, column.status, onMove, readOnly])

  const shown = issues.slice(0, COLUMN_CAP)

  return (
    <section
      ref={region}
      aria-label={`${column.label} column`}
      className={cn(
        'flex min-w-0 flex-col rounded-lg border border-line bg-surface',
        over && 'border-accent bg-accent/5',
      )}
    >
      <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <h2 className="text-sm font-semibold text-ink">{column.label}</h2>
        <Badge tone="outline">{issues.length}</Badge>
      </header>

      <div className="min-h-24 space-y-2 p-2">
        {shown.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-subtle">Nothing here</p>
        ) : (
          shown.map((issue) => (
            <IssueCard
              key={issue.id}
              issue={issue}
              columns={columns}
              onMove={onMove}
              onOpen={onOpen}
              readOnly={readOnly}
            />
          ))
        )}
        {issues.length > shown.length ? (
          <p className="px-1 pb-1 text-center text-[11px] text-subtle">
            {issues.length - shown.length} more; narrow the filters to see them
          </p>
        ) : null}
      </div>
    </section>
  )
}

export function IssueCard({
  issue,
  columns,
  onMove,
  onOpen,
  readOnly,
}: {
  issue: Issue
  columns: BoardColumn[]
  onMove: (issue: Issue, status: WorkflowStatus) => void
  onOpen?: (issue: Issue) => void
  readOnly: boolean
}) {
  const element = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const node = element.current
    if (node === null || readOnly) return
    return draggable({
      element: node,
      getInitialData: () => ({ issue }),
      onDragStart: () => setDragging(true),
      onDrop: () => setDragging(false),
    })
  }, [issue, readOnly])

  return (
    <div
      ref={element}
      role="article"
      aria-label={`${issue.repository}#${issue.number} ${issue.title}`}
      tabIndex={0}
      className={cn(
        'rounded-md border border-line bg-surface-2/40 px-2.5 py-2 text-sm outline-none',
        'focus-visible:border-accent',
        dragging && 'opacity-50',
      )}
    >
      <div className="flex min-w-0 items-start gap-1.5">
        <Badge tone="outline">{issue.repository.split('/')[1] ?? issue.repository}</Badge>
        <a
          className="font-mono text-[11px] text-subtle underline-offset-2 hover:text-accent hover:underline"
          href={issue.htmlUrl}
          target="_blank"
          rel="noreferrer noopener"
        >
          #{issue.number}
        </a>
        {issue.issueType ? <Badge tone="neutral">{issue.issueType}</Badge> : null}

        {/* The keyboard and touch path: the same mutation, no drag involved. */}
        <Menu>
          <MenuTrigger
            aria-label={`Actions for ${issue.repository}#${issue.number}`}
            className="ml-auto rounded p-0.5 text-subtle hover:bg-surface-2 hover:text-ink"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </MenuTrigger>
          <MenuContent>
            {onOpen ? <MenuItem onSelect={() => onOpen(issue)}>Open</MenuItem> : null}
            {columns.map((column) => (
              <MenuItem
                key={column.id}
                disabled={readOnly || issue.status === column.status}
                onSelect={() => onMove(issue, column.status)}
              >
                Move to {column.label}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
      </div>

      <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-ink">{issue.title}</p>

      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-subtle">
        {issue.priority ? (
          <Badge tone={PRIORITY_TONE[issue.priority]}>priority: {issue.priority}</Badge>
        ) : null}
        {issue.childIds.length > 0 ? (
          <span>
            {issue.childIds.length} sub-{issue.childIds.length === 1 ? 'issue' : 'issues'}
          </span>
        ) : null}
        {issue.assignees.length > 0 ? <span>@{issue.assignees[0]}</span> : null}
        {issue.metadataSource === 'labels' ? (
          <span title="this status comes from the status: label convention">·</span>
        ) : null}
      </div>
    </div>
  )
}

export function BoardEmpty() {
  return (
    <Empty
      title="No issue matches these filters"
      hint="Issues come from the panel's projection. Press Sync under Settings → GitHub if the board looks empty."
    />
  )
}
