import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ExternalLink, Plus } from 'lucide-react'
import { api, ApiError } from '../lib/api.ts'
import type { Project, ProjectEnvironment } from '../../shared/types.ts'
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

/**
 * The product: what the operator recognises, as opposed to what this host is
 * running. `tab` is carried only so an old `#/projects/<compose-name>/logs`
 * bookmark lands on the environment's Logs tab after the redirect below.
 */
export function ProjectPage({ slug, tab = null }: { slug: string; tab?: string | null }) {
  const { t } = useTranslation('projects')
  const { t: tc } = useTranslation('common')
  const { t: ti } = useTranslation('issues')
  const queryClient = useQueryClient()
  const [attaching, setAttaching] = useState(false)
  const query = useQuery({
    queryKey: ['project', slug],
    queryFn: () => api.project(slug),
    retry: false,
  })

  useDocumentTitle(query.data?.name ?? slug, t('title'))

  const remove = useMutation({
    mutationFn: () => api.deleteProject(slug),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
      navigate('/projects')
    },
  })

  if (query.isPending) return <Loading />

  if (query.error) {
    const status = query.error instanceof ApiError ? query.error.status : null
    // Before the rename, `#/projects/<name>` was the Compose stack. A slug that
    // is not a Project is sent where that page lives now: one request, one
    // redirect, never a second page rendered on a guess.
    if (status === 404) return <LegacyEnvironmentRedirect name={slug} tab={tab} />
    if (status === 503) {
      return (
        <>
          <PageHeader title={slug} />
          <Card>
            <Empty title={t('needsDatabase')} hint={t('needsDatabaseHint')} />
          </Card>
        </>
      )
    }
    return <ErrorBox error={query.error} />
  }

  const project = query.data!

  return (
    <>
      <PageHeader
        title={project.name}
        description={
          [project.description, project.archived ? t('archived') : null].filter(Boolean).join(' · ') ||
          undefined
        }
        actions={
          <>
            <Button size="sm" onClick={() => navigate('/projects')}>
              {t('allProjects')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => navigate(`/projects/${encodeURIComponent(project.slug)}/board`)}
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
          {project.githubRepositories.length === 0 ? (
            <Empty title={t('repositoriesCard.empty')} hint={t('repositoriesCard.emptyHint')} />
          ) : (
            <div>
              {project.githubRepositories.map((repository) => (
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
                  {repository.private ? <Badge tone="neutral">{t('detail.private')}</Badge> : null}
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
          {project.environments.length === 0 ? (
            <Empty title={t('environments.empty')} hint={t('environments.emptyHint')} />
          ) : (
            <div>
              {project.environments.map((environment) => (
                <EnvironmentRow key={environment.environment} environment={environment} />
              ))}
            </div>
          )}
        </Card>

        <IssuesCard slug={project.slug} />
      </div>

      {attaching ? (
        <RepositoriesDialog project={project} open onOpenChange={setAttaching} />
      ) : null}
    </>
  )
}

/** Sends an old environment bookmark to the environment page. */
export function LegacyEnvironmentRedirect({ name, tab }: { name: string; tab: string | null }) {
  useEffect(() => {
    navigate(`/environments/${encodeURIComponent(name)}${tab ? `/${encodeURIComponent(tab)}` : ''}`)
  }, [name, tab])
  return <Loading />
}

function EnvironmentRow({ environment }: { environment: ProjectEnvironment }) {
  const { t } = useTranslation('projects')

  const sourceReason =
    environment.source === 'repo-match'
      ? t('detail.sourceReason.repoMatch')
      : environment.source === 'label'
        ? t('detail.sourceReason.label')
        : t('detail.sourceReason.manual')

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
        <Badge tone="danger">{t('detail.unhealthyCount', { count: environment.unhealthyCount })}</Badge>
      ) : null}
      <span className="text-xs text-subtle">{sourceReason}</span>
    </div>
  )
}

function RepositoriesDialog({
  project,
  open,
  onOpenChange,
}: {
  project: Project
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('projects')
  const { t: tc } = useTranslation('common')
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<string[]>(
    project.githubRepositories.map((repository) => repository.fullName),
  )
  const available = useQuery({
    queryKey: ['github-repositories'],
    queryFn: api.githubRepositories,
    retry: false,
  })

  const save = useMutation({
    mutationFn: () =>
      api.setProjectRepositories(
        project.slug,
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
      title={t('detail.repositoriesFor', { name: project.name })}
      description={t('repositoriesCard.attach.description')}
      footer={
        <Button variant="primary" size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
          {tc('save')}
        </Button>
      }
    >
      {save.error ? <ErrorBox error={save.error} /> : null}
      {available.isPending ? <Loading label={t('repositoriesCard.attach.reading')} /> : null}
      {available.error ? (
        <Empty
          title={unavailable ? t('repositoriesCard.attach.unavailable') : t('repositoriesCard.attach.noList')}
          hint={t('repositoriesCard.attach.hint')}
        />
      ) : (available.data ?? []).length === 0 ? (
        <Empty
          title={t('repositoriesCard.attach.noneGranted')}
          hint={t('repositoriesCard.attach.noneGrantedHint')}
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
              {repository.private ? <Badge tone="neutral">{t('detail.private')}</Badge> : null}
            </label>
          ))}
        </div>
      )}
    </Dialog>
  )
}

function IssuesCard({ slug }: { slug: string }) {
  const { t } = useTranslation('projects', { keyPrefix: 'issues' })
  const { statusOptions } = useIssueStatuses()
  const [state, setState] = useState('open')
  const [status, setStatus] = useState('')
  const [text, setText] = useState('')

  const query = useQuery({
    queryKey: ['project-issues', slug, state, status, text],
    queryFn: () =>
      api.projectIssues(slug, {
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
              <option value="">{t('anyStatus')}</option>
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
              <option value="open">{t('stateOpen')}</option>
              <option value="closed">{t('stateClosed')}</option>
              <option value="">{t('stateAll')}</option>
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
