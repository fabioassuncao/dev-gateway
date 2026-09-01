import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Plus } from 'lucide-react'
import { api, ApiError } from '../lib/api.ts'
import type { Workspace, WorkspaceEnvironment } from '../../shared/types.ts'
import { Badge } from '../components/ui/badge.tsx'
import { Button } from '../components/ui/button.tsx'
import { Card, CardHeader } from '../components/ui/card.tsx'
import { Dialog } from '../components/ui/dialog.tsx'
import { Input, Select } from '../components/ui/field.tsx'
import { Empty, ErrorBox, Loading, PageHeader } from '../components/shell-bits.tsx'
import { IssueRows } from '../components/issue-list.tsx'
import { navigate } from '../lib/router.ts'
import { useDocumentTitle } from '../lib/title.ts'

const SOURCE_REASON: Record<WorkspaceEnvironment['source'], string> = {
  manual: 'linked by hand',
  label: 'declared by its dev-gateway.project label',
  'repo-match': 'its repository belongs to this workspace',
}

export function WorkspacePage({ slug }: { slug: string }) {
  const queryClient = useQueryClient()
  const [attaching, setAttaching] = useState(false)
  const query = useQuery({
    queryKey: ['workspace', slug],
    queryFn: () => api.workspace(slug),
    retry: false,
  })

  useDocumentTitle(query.data?.name ?? slug, 'Workspaces')

  const remove = useMutation({
    mutationFn: () => api.deleteWorkspace(slug),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      navigate('/workspaces')
    },
  })

  if (query.isPending) return <Loading />

  if (query.error) {
    const missing = query.error instanceof ApiError && query.error.status === 404
    if (!missing) return <ErrorBox error={query.error} />
    return (
      <>
        <PageHeader title={slug} />
        <Card>
          <Empty
            title={`No workspace '${slug}'`}
            hint={
              <a className="text-accent hover:underline" href="#/workspaces">
                Back to all workspaces
              </a>
            }
          />
        </Card>
      </>
    )
  }

  const workspace = query.data!

  return (
    <>
      <PageHeader
        title={workspace.name}
        description={
          [workspace.description, workspace.archived ? 'archived' : null].filter(Boolean).join(' · ') ||
          undefined
        }
        actions={
          <>
            <Button size="sm" onClick={() => navigate('/workspaces')}>
              All workspaces
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => navigate(`/board/${encodeURIComponent(workspace.slug)}/board`)}
            >
              Board
            </Button>
            <Button size="sm" onClick={() => setAttaching(true)}>
              <Plus className="h-3.5 w-3.5" />
              Repositories
            </Button>
            <Button size="sm" disabled={remove.isPending} onClick={() => remove.mutate()}>
              Delete
            </Button>
          </>
        }
      />

      {remove.error ? <ErrorBox error={remove.error} /> : null}

      <div className="space-y-4">
        <Card>
          <CardHeader
            title="Repositories"
            description="From the GitHub App installation. A repository may belong to more than one workspace."
          />
          {workspace.repositories.length === 0 ? (
            <Empty
              title="No repository attached"
              hint="Attach one the GitHub App was granted. With no App configured, a workspace still groups environments."
            />
          ) : (
            <div>
              {workspace.repositories.map((repository) => (
                <div
                  key={repository.repositoryId}
                  className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2 text-sm last:border-b-0"
                >
                  <a
                    className="font-medium underline-offset-2 hover:text-accent hover:underline"
                    href={repository.htmlUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {repository.fullName}
                    <ExternalLink className="ml-1 inline h-3 w-3" />
                  </a>
                  {repository.role ? <Badge tone="outline">{repository.role}</Badge> : null}
                  {repository.private ? <Badge tone="neutral">private</Badge> : null}
                  {repository.archived ? <Badge tone="warn">archived</Badge> : null}
                  {repository.defaultBranch ? (
                    <span className="font-mono text-[11px] text-subtle">{repository.defaultBranch}</span>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Environments"
            description="Compose projects on this host that belong to this workspace, and why."
          />
          {workspace.environments.length === 0 ? (
            <Empty
              title="Nothing is running for this workspace"
              hint="Start an environment, label it dev-gateway.project with this slug, or link one by hand."
            />
          ) : (
            <div>
              {workspace.environments.map((environment) => (
                <div
                  key={environment.project}
                  className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2 text-sm last:border-b-0"
                >
                  <a
                    className="font-medium underline-offset-2 hover:text-accent hover:underline"
                    href={`#/projects/${encodeURIComponent(environment.project)}`}
                  >
                    {environment.project}
                  </a>
                  <Badge tone={environment.runningCount === environment.serviceCount ? 'ok' : 'warn'}>
                    {environment.runningCount}/{environment.serviceCount} running
                  </Badge>
                  {environment.unhealthyCount > 0 ? (
                    <Badge tone="danger">{environment.unhealthyCount} unhealthy</Badge>
                  ) : null}
                  <span className="text-xs text-subtle">{SOURCE_REASON[environment.source]}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <IssuesCard slug={workspace.slug} />
      </div>

      {attaching ? (
        <RepositoriesDialog workspace={workspace} open onOpenChange={setAttaching} />
      ) : null}
    </>
  )
}

function RepositoriesDialog({
  workspace,
  open,
  onOpenChange,
}: {
  workspace: Workspace
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<string[]>(
    workspace.repositories.map((repository) => repository.fullName),
  )
  const available = useQuery({
    queryKey: ['github-repositories'],
    queryFn: api.githubRepositories,
    retry: false,
  })

  const save = useMutation({
    mutationFn: () =>
      api.setWorkspaceRepositories(
        workspace.slug,
        selected.map((fullName) => ({ fullName })),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries()
      onOpenChange(false)
    },
  })

  const unavailable = available.error instanceof ApiError && available.error.status === 503

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Repositories for ${workspace.name}`}
      description="Only repositories the GitHub App installation granted can be attached."
      footer={
        <Button variant="primary" size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      {save.error ? <ErrorBox error={save.error} /> : null}
      {available.isPending ? <Loading label="Reading the projection" /> : null}
      {available.error ? (
        <Empty
          title={unavailable ? 'The projection is unavailable' : 'No repository list'}
          hint="Configure the GitHub App under Settings → GitHub and press Sync. A workspace works without it; it just has no repositories."
        />
      ) : (available.data ?? []).length === 0 ? (
        <Empty
          title="No repository has been granted yet"
          hint="Install the GitHub App on the repositories this workspace owns, then press Sync under Settings → GitHub."
        />
      ) : (
        <div className="space-y-1">
          {(available.data ?? []).map((repository) => (
            <label key={repository.githubId} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(repository.fullName)}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, repository.fullName]
                      : current.filter((entry) => entry !== repository.fullName),
                  )
                }
              />
              {repository.fullName}
              {repository.private ? <Badge tone="neutral">private</Badge> : null}
            </label>
          ))}
        </div>
      )}
    </Dialog>
  )
}

/**
 * The workspace's issues, read from the projection.
 *
 * Filters live in component state rather than the URL for now: the board issue
 * puts them in the hash, where a filtered view becomes a link somebody can
 * paste. Everything here answers while GitHub is unreachable, and says how old
 * it is when it does.
 */
function IssuesCard({ slug }: { slug: string }) {
  const [state, setState] = useState('open')
  const [status, setStatus] = useState('')
  const [text, setText] = useState('')

  const query = useQuery({
    queryKey: ['workspace-issues', slug, state, status, text],
    queryFn: () =>
      api.workspaceIssues(slug, {
        ...(state === '' ? {} : { state }),
        ...(status === '' ? {} : { status }),
        ...(text.trim() === '' ? {} : { q: text.trim() }),
      }),
    retry: false,
  })

  const unavailable = query.error instanceof ApiError && query.error.status === 503

  return (
    <Card>
      <CardHeader
        title="Issues"
        description="Projected from GitHub. Every row says how old the answer is."
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <Input
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Filter by number or title"
              className="h-7 w-52"
              aria-label="Filter issues"
            />
            <Select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="h-7 w-36"
              aria-label="Status"
            >
              <option value="">Any status</option>
              <option value="backlog">Backlog</option>
              <option value="ready">Ready</option>
              <option value="in_progress">In Progress</option>
              <option value="review">Review</option>
              <option value="blocked">Blocked</option>
              <option value="done">Done</option>
            </Select>
            <Select
              value={state}
              onChange={(event) => setState(event.target.value)}
              className="h-7 w-28"
              aria-label="Issue state"
            >
              <option value="open">Open</option>
              <option value="closed">Closed</option>
              <option value="">All</option>
            </Select>
          </div>
        }
      />
      {query.isPending ? <Loading label="Reading the issue projection" /> : null}
      {query.error ? (
        unavailable ? (
          <Empty
            title="Issues need the panel's database"
            hint="They are a projection of GitHub, kept locally so they answer while GitHub is unreachable."
          />
        ) : (
          <div className="p-3">
            <ErrorBox error={query.error} />
          </div>
        )
      ) : null}
      {query.data ? <IssueRows issues={query.data} /> : null}
    </Card>
  )
}
