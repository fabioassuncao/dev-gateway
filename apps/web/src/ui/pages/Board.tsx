import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { api, ApiError } from '../lib/api.ts'
import type { Issue, WorkflowStatus } from '../../shared/types.ts'
import { Badge } from '../components/ui/badge.tsx'
import { Button } from '../components/ui/button.tsx'
import { Card, CardHeader } from '../components/ui/card.tsx'
import { Input, Select } from '../components/ui/field.tsx'
import { Empty, ErrorBox, Loading, PageHeader } from '../components/shell-bits.tsx'
import { Tabs, TabPanel } from '../components/ui/tabs.tsx'
import { BoardEmpty, DEFAULT_COLUMNS, IssueBoard } from '../components/issue-board.tsx'
import { IssueRows } from '../components/issue-list.tsx'
import { IssueDialog } from '../components/issue-dialog.tsx'
import { useOptimisticMutation } from '../lib/optimistic.ts'
import { navigate } from '../lib/router.ts'
import { useDocumentTitle } from '../lib/title.ts'

/** Filters that live in the hash, so a filtered board is a link. */
const FILTERS = ['repository', 'status', 'priority', 'type', 'assignee', 'milestone', 'label', 'q'] as const
type FilterKey = (typeof FILTERS)[number]

export type BoardView = 'board' | 'backlog'

export function resolveView(requested: string | null): BoardView {
  return requested === 'backlog' ? 'backlog' : 'board'
}

function hashFor(slug: string, view: BoardView, filters: Partial<Record<FilterKey, string>>): string {
  const query = new URLSearchParams()
  for (const key of FILTERS) {
    const value = filters[key]
    if (value) query.set(key, value)
  }
  const suffix = query.toString()
  return `/board/${encodeURIComponent(slug)}/${view}${suffix ? `?${suffix}` : ''}`
}

export function BoardPage({
  slug,
  view: requested,
  filters,
  readOnly = false,
}: {
  slug: string
  view: string | null
  filters: Partial<Record<FilterKey, string>>
  readOnly?: boolean
}) {
  const view = resolveView(requested)
  useDocumentTitle(view === 'backlog' ? 'Backlog' : 'Board', slug)

  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Issue | null>(null)
  const [failure, setFailure] = useState<unknown>(null)

  // The backlog is what has no status and no schedule yet; the board is what
  // does. Two views, one projection.
  const query = {
    ...filters,
    ...(view === 'backlog' ? {} : { state: 'open' }),
  } as Record<string, string>

  const queryKey = ['board-issues', slug, view, JSON.stringify(query)]
  const issues = useQuery({
    queryKey,
    queryFn: () => api.workspaceIssues(slug, query),
    retry: false,
  })

  const move = useOptimisticMutation<Issue, { issue: Issue; status: WorkflowStatus }, Issue[]>({
    queryKey,
    mutationFn: ({ issue, status }) => api.patchIssue(issue.id, { status }),
    update: (current, { issue, status }) =>
      current?.map((entry) => (entry.id === issue.id ? { ...entry, status } : entry)),
    onFailure: (error) => setFailure(error),
  })

  const workspace = useQuery({
    queryKey: ['workspace', slug],
    queryFn: () => api.workspace(slug),
    retry: false,
  })

  if (issues.isPending) return <Loading />

  const unavailable = issues.error instanceof ApiError && issues.error.status === 503

  const setFilter = (key: FilterKey, value: string) =>
    navigate(hashFor(slug, view, { ...filters, [key]: value === '' ? undefined : value }))

  const backlog = view === 'backlog'
  const shown = backlog ? (issues.data ?? []).filter((issue) => issue.status === null) : (issues.data ?? [])

  return (
    <>
      <PageHeader
        title={workspace.data?.name ?? slug}
        description={
          backlog
            ? 'Work with no status yet, ordered by priority and last change.'
            : 'Every open issue of this workspace, by status.'
        }
        actions={
          <>
            <Button size="sm" onClick={() => navigate(`/workspaces/${encodeURIComponent(slug)}`)}>
              Workspace
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={readOnly || (workspace.data?.repositories.length ?? 0) === 0}
              onClick={() => setCreating(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              New issue
            </Button>
          </>
        }
      />

      <Tabs
        label={`${slug} views`}
        active={view}
        tabs={[
          { id: 'board', label: 'Board', href: hashFor(slug, 'board', filters) },
          { id: 'backlog', label: 'Backlog', href: hashFor(slug, 'backlog', filters) },
        ]}
      />

      <TabPanel id={view}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Input
            value={filters.q ?? ''}
            onChange={(event) => setFilter('q', event.target.value)}
            placeholder="Filter by number or title"
            className="h-8 w-56"
            aria-label="Filter issues"
          />
          <Select
            value={filters.repository ?? ''}
            onChange={(event) => setFilter('repository', event.target.value)}
            className="h-8 w-48"
            aria-label="Repository"
          >
            <option value="">Any repository</option>
            {(workspace.data?.repositories ?? []).map((repository) => (
              <option key={repository.repositoryId} value={repository.fullName}>
                {repository.fullName}
              </option>
            ))}
          </Select>
          <Select
            value={filters.priority ?? ''}
            onChange={(event) => setFilter('priority', event.target.value)}
            className="h-8 w-36"
            aria-label="Priority"
          >
            <option value="">Any priority</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </Select>
          <Input
            value={filters.assignee ?? ''}
            onChange={(event) => setFilter('assignee', event.target.value)}
            placeholder="Assignee"
            className="h-8 w-36"
            aria-label="Assignee"
          />
          <Input
            value={filters.label ?? ''}
            onChange={(event) => setFilter('label', event.target.value)}
            placeholder="Label"
            className="h-8 w-36"
            aria-label="Label"
          />
          {readOnly ? <Badge tone="outline">read-only</Badge> : null}
        </div>

        {failure ? (
          <div className="mb-3">
            <ErrorBox error={failure} />
          </div>
        ) : null}

        {issues.error ? (
          unavailable ? (
            <Card>
              <Empty
                title="The board needs the panel's database"
                hint="Issues are a projection of GitHub, kept locally so the board answers while GitHub is unreachable."
              />
            </Card>
          ) : (
            <ErrorBox error={issues.error} />
          )
        ) : backlog ? (
          <Card>
            <CardHeader
              title="Backlog"
              description="Unprioritised and unscheduled work, with sub-issues nested under their parent."
            />
            <IssueRows issues={shown} onSelect={setEditing} />
          </Card>
        ) : shown.length === 0 ? (
          <Card>
            <BoardEmpty />
          </Card>
        ) : (
          <IssueBoard
            issues={shown}
            columns={DEFAULT_COLUMNS}
            readOnly={readOnly}
            onOpen={setEditing}
            onMove={(issue, status) => {
              setFailure(null)
              move.mutate({ issue, status })
            }}
          />
        )}
      </TabPanel>

      {creating ? (
        <IssueDialog
          mode="create"
          repositories={(workspace.data?.repositories ?? []).map((repository) => repository.fullName)}
          open
          onOpenChange={setCreating}
        />
      ) : null}
      {editing ? (
        <IssueDialog mode="edit" issue={editing} open onOpenChange={() => setEditing(null)} />
      ) : null}
    </>
  )
}
