import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
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
import { useIssueStatuses } from '../i18n/use-issue-statuses.ts'
import { navigate } from '../lib/router.ts'
import { useDocumentTitle } from '../lib/title.ts'

export function WorkspacePage({ slug }: { slug: string }) {
  const { t } = useTranslation('workspaces')
  const { t: ti } = useTranslation('issues')
  const { t: tc } = useTranslation('common')
  const queryClient = useQueryClient()
  const [attaching, setAttaching] = useState(false)
  const query = useQuery({
    queryKey: ['workspace', slug],
    queryFn: () => api.workspace(slug),
    retry: false,
  })

  useDocumentTitle(query.data?.name ?? slug, t('title'))

  const remove = useMutation({
    mutationFn: () => api.deleteWorkspace(slug),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      navigate('/projects')
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
            title={t('notFound', { slug })}
            hint={
              <a className="text-accent hover:underline" href="#/projects">
                {t('backToAll', { defaultValue: 'Back to all projects' })}
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
          [workspace.description, workspace.archived ? t('archived') : null].filter(Boolean).join(' · ') ||
          undefined
        }
        actions={
          <>
            <Button size="sm" onClick={() => navigate('/projects')}>
              {t('allWorkspaces', { defaultValue: 'All projects' })}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => navigate(`/board/${encodeURIComponent(workspace.slug)}/board`)}
            >
              {ti('board')}
            </Button>
            <Button size="sm" onClick={() => setAttaching(true)}>
              <Plus className="h-3.5 w-3.5" />
              {t('repositoriesCard.title')}
            </Button>
            <Button size="sm" disabled={remove.isPending} onClick={() => remove.mutate()}>
              {tc('delete')}
            </Button>
          </>
        }
      />

      {remove.error ? <ErrorBox error={remove.error} /> : null}

      <div className="space-y-4">
        <Card>
          <CardHeader
            title={t('repositoriesCard.title')}
            description={t('repositoriesCard.description')}
          />
          {workspace.githubRepositories.length === 0 ? (
            <Empty title={t('repositoriesCard.empty')} hint={t('repositoriesCard.emptyHint')} />
          ) : (
            <div>
              {workspace.githubRepositories.map((repository) => (
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
                  {repository.private ? (
                    <Badge tone="neutral">{t('private', { defaultValue: 'private' })}</Badge>
                  ) : null}
                  {repository.archived ? <Badge tone="warn">{t('archived')}</Badge> : null}
                  {repository.defaultBranch ? (
                    <span className="font-mono text-[11px] text-subtle">{repository.defaultBranch}</span>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title={t('environments.title')} description={t('environments.description')} />
          {workspace.environments.length === 0 ? (
            <Empty title={t('environments.empty')} hint={t('environments.emptyHint')} />
          ) : (
            <div>
              {workspace.environments.map((environment) => (
                <EnvironmentRow key={environment.environment} environment={environment} />
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

function EnvironmentRow({ environment }: { environment: WorkspaceEnvironment }) {
  const { t } = useTranslation('workspaces')
  const { t: ti } = useTranslation('issues')

  const sourceReason =
    environment.source === 'repo-match'
      ? t('sourceReason.repoMatch', { defaultValue: 'its repository belongs to this workspace' })
      : environment.source === 'label'
        ? t('sourceReason.label', { defaultValue: 'declared by its portta.project label' })
        : ti('linkReason.manual', { defaultValue: 'linked by hand' })

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2 text-sm last:border-b-0">
      <a
        className="font-medium underline-offset-2 hover:text-accent hover:underline"
        href={`#/environments/${encodeURIComponent(environment.environment)}`}
      >
        {environment.environment}
      </a>
      <Badge tone={environment.runningCount === environment.serviceCount ? 'ok' : 'warn'}>
        {t('running', {
          running: environment.runningCount,
          total: environment.serviceCount,
        })}
      </Badge>
      {environment.unhealthyCount > 0 ? (
        <Badge tone="danger">{t('unhealthyCount', { defaultValue: '{{count}} unhealthy', count: environment.unhealthyCount })}</Badge>
      ) : null}
      <span className="text-xs text-subtle">{sourceReason}</span>
    </div>
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
  const { t } = useTranslation('workspaces')
  const { t: tc } = useTranslation('common')
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<string[]>(
    workspace.githubRepositories.map((repository) => repository.fullName),
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
      title={t('repositoriesFor', { defaultValue: 'Repositories for {{name}}', name: workspace.name })}
      description={t('attachRepo.description')}
      footer={
        <Button variant="primary" size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
          {tc('save')}
        </Button>
      }
    >
      {save.error ? <ErrorBox error={save.error} /> : null}
      {available.isPending ? <Loading label={t('attachRepo.reading')} /> : null}
      {available.error ? (
        <Empty
          title={unavailable ? t('attachRepo.unavailable') : t('attachRepo.noList')}
          hint={t('attachRepo.hint')}
        />
      ) : (available.data ?? []).length === 0 ? (
        <Empty title={t('attachRepo.noneGranted')} hint={t('attachRepo.noneGrantedHint')} />
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
              {repository.private ? (
                <Badge tone="neutral">{t('private', { defaultValue: 'private' })}</Badge>
              ) : null}
            </label>
          ))}
        </div>
      )}
    </Dialog>
  )
}

function IssuesCard({ slug }: { slug: string }) {
  const { t } = useTranslation('workspaces', { keyPrefix: 'issues' })
  const { statusOptions } = useIssueStatuses()
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
        title={t('title')}
        description={t('description')}
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <Input
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={t('filterPlaceholder')}
              className="h-7 w-52"
              aria-label={t('filterAria')}
            />
            <Select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="h-7 w-36"
              aria-label={t('status')}
            >
              <option value="">{t('anyStatus', { defaultValue: 'Any status' })}</option>
              {statusOptions
                .filter((entry) => entry.value !== '')
                .map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
            </Select>
            <Select
              value={state}
              onChange={(event) => setState(event.target.value)}
              className="h-7 w-28"
              aria-label={t('state')}
            >
              <option value="open">{t('stateOpen', { defaultValue: 'Open' })}</option>
              <option value="closed">{t('stateClosed', { defaultValue: 'Closed' })}</option>
              <option value="">{t('stateAll', { defaultValue: 'All' })}</option>
            </Select>
          </div>
        }
      />
      {query.isPending ? <Loading label={t('reading')} /> : null}
      {query.error ? (
        unavailable ? (
          <Empty title={t('needsDatabase')} hint={t('needsDatabaseHint')} />
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
