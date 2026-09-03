import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { api, ApiError } from '../lib/api/index.ts'
import {
  keys,
  useDiscoveredRepositories,
  useEnvironments,
  useGitHubRepositories,
  useMetricsCurrent,
  useNextTask,
  useProject,
  useProjectActivity,
  useSessions,
  useTasks,
} from '../lib/queries/index.ts'
import type { Environment, Project, ProjectEnvironment, Repository } from '../../shared/types.ts'
import type { TaskSummary } from '../../shared/task-types.ts'
import { Badge } from '../components/ui/badge.tsx'
import { Button } from '../components/ui/button.tsx'
import { Card, CardBody, CardHeader } from '../components/ui/card.tsx'
import { Dialog } from '../components/ui/dialog.tsx'
import { Input, Select } from '../components/ui/field.tsx'
import { Switch } from '../components/ui/switch.tsx'
import { Tabs, TabPanel } from '../components/ui/tabs.tsx'
import { RepositoryRow } from '../components/entities/repository-row.tsx'
import { EnvironmentCard } from '../components/entities/environment-card.tsx'
import { EnvironmentOpenMenu } from '../components/entities/open-test-menu.tsx'
import { ResourceUsage } from '../components/entities/resource-usage.tsx'
import { SessionRow } from '../components/entities/session-row.tsx'
import { ActivityTimeline } from '../components/entities/activity-timeline.tsx'
import { TaskRow } from '../components/entities/task-row.tsx'
import { TasksTab } from '../components/tasks/tasks-tab.tsx'
import { TaskDialog } from '../components/tasks/task-dialog.tsx'
import { Empty, ErrorBox, Loading, PageHeader } from '../components/shell-bits.tsx'
import { environmentHealth, healthTone } from '../lib/health.ts'
import { navigate } from '../lib/router.ts'
import { resolveTaskView, taskFiltersFrom, taskHref, tasksHref } from '../lib/tasks.ts'
import { useDocumentTitle } from '../lib/title.ts'

const TABS = ['overview', 'tasks', 'repositories', 'environments', 'activity', 'settings'] as const
type Tab = (typeof TABS)[number]

function resolveTab(requested: string | null): Tab {
  return (TABS as readonly string[]).includes(requested ?? '') ? (requested as Tab) : 'overview'
}

/**
 * The cockpit of one product: what needs doing, who is on it, what code it
 * has, what is running, and what happened. Each tab is a URL.
 */
export function ProjectPage({ slug, tab: requested = null, query = '', readOnly = false }: { slug: string; tab?: string | null; query?: string; readOnly?: boolean }) {
  const { t } = useTranslation('projects')
  const project = useProject(slug)
  const tab = resolveTab(requested)
  const [creatingTask, setCreatingTask] = useState(false)

  useDocumentTitle(project.data?.name ?? slug, t('title'))

  if (project.isPending) return <Loading />

  if (project.error) {
    const status = project.error instanceof ApiError ? project.error.status : null
    // Before the rename, `#/projects/<name>` was the Compose stack. A slug that
    // is not a Project is sent where that page lives now: one request, one
    // redirect, never a second page rendered on a guess.
    if (status === 404) return <LegacyEnvironmentRedirect name={slug} tab={requested} />
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
    return <ErrorBox error={project.error} />
  }

  const data = project.data!
  const base = `/projects/${encodeURIComponent(slug)}`
  const params = new URLSearchParams(query.replace(/^\?/, ''))
  const tabs = [
    { id: 'overview', label: t('tabs.overview'), href: base },
    { id: 'tasks', label: t('tabs.tasks'), href: `${base}/tasks` },
    { id: 'repositories', label: t('tabs.repositories', { count: data.repositories.length }), href: `${base}/repositories` },
    { id: 'environments', label: t('tabs.environments', { count: data.environments.length }), href: `${base}/environments` },
    { id: 'activity', label: t('tabs.activity'), href: `${base}/activity` },
    { id: 'settings', label: t('tabs.settings'), href: `${base}/settings` },
  ]

  return (
    <>
      <ProjectHeader project={data} readOnly={readOnly} onNewTask={() => setCreatingTask(true)} />
      <Tabs label={t('tabs.label', { name: data.name })} active={tab} tabs={tabs} />
      <TabPanel id={tab}>
        {tab === 'overview' ? <OverviewTab project={data} readOnly={readOnly} /> : null}
        {tab === 'tasks' ? <TasksTab project={data} view={resolveTaskView(params.get('view'))} filters={taskFiltersFrom(params)} readOnly={readOnly} /> : null}
        {tab === 'repositories' ? <RepositoriesTab project={data} readOnly={readOnly} /> : null}
        {tab === 'environments' ? <EnvironmentsTab project={data} readOnly={readOnly} /> : null}
        {tab === 'activity' ? <ActivityTab slug={slug} /> : null}
        {tab === 'settings' ? <SettingsTab project={data} readOnly={readOnly} /> : null}
      </TabPanel>
      {creatingTask ? <TaskDialog mode="create" slug={slug} project={data} open onOpenChange={setCreatingTask} onSaved={(task) => navigate(taskHref(slug, task.id).replace(/^#/, ''))} /> : null}
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

function ProjectHeader({ project, readOnly, onNewTask }: { project: Project; readOnly: boolean; onNewTask: () => void }) {
  const { t } = useTranslation('projects')
  const { t: tk } = useTranslation('tasks')
  const { t: tn } = useTranslation('nav')
  const tasks = useTasks(project.slug, { open: 'true' })
  const sessions = useSessions(project.slug, { active: true })
  const environments = useEnvironments(true)
  const primary = primaryEnvironment(project, environments.data ?? [])
  const running = project.environments.filter((entry) => entry.running).length
  const unhealthy = project.environments.reduce((sum, entry) => sum + entry.unhealthyCount, 0)
  const open = (tasks.data ?? []).length
  const inProgress = (tasks.data ?? []).filter((task) => task.status === 'in_progress').length
  const active = (sessions.data ?? []).length
  return (
    <PageHeader
      title={project.name}
      breadcrumb={[{ label: tn('projects'), href: '#/projects' }, { label: project.name }]}
      description={
        <span className="flex flex-wrap items-center gap-2">
          {project.description ? <span>{project.description}</span> : null}
          {project.archived ? <Badge tone="outline">{t('archived')}</Badge> : null}
          {project.environments.length > 0 ? (
            <Badge tone={unhealthy > 0 ? 'danger' : running > 0 ? 'ok' : 'neutral'}>
              {t('running', { running, total: project.environments.length })}
              {unhealthy > 0 ? ` · ${t('pulse.unhealthy', { count: unhealthy })}` : ''}
            </Badge>
          ) : null}
          {tasks.data ? <Badge tone={inProgress > 0 ? 'info' : 'outline'}>{t('pulse.tasks', { open, inProgress })}</Badge> : null}
          {active > 0 ? <Badge tone="accent">{t('pulse.sessions', { count: active })}</Badge> : null}
        </span>
      }
      actions={
        <>
          {primary ? <EnvironmentOpenMenu environment={primary} /> : null}
          <Button size="sm" variant="primary" disabled={readOnly} onClick={onNewTask}>
            <Plus className="h-3.5 w-3.5" />
            {tk('newTask')}
          </Button>
        </>
      }
    />
  )
}

/** The environment the Open menu targets: the first running one, else the first. */
function primaryEnvironment(project: Project, environments: Environment[]): Environment | null {
  const known = new Map(environments.map((environment) => [environment.name, environment]))
  const adopted = project.environments.map((entry) => known.get(entry.environment)).filter((environment): environment is Environment => environment !== undefined)
  return adopted.find((environment) => environment.runningCount > 0) ?? adopted[0] ?? null
}

function OverviewTab({ project, readOnly }: { project: Project; readOnly: boolean }) {
  const { t } = useTranslation('projects')
  const { t: tk } = useTranslation('tasks')
  const { t: ts } = useTranslation('sessions')
  const { t: ta } = useTranslation('activity')
  const tasks = useTasks(project.slug, { open: 'true' })
  const next = useNextTask(project.slug)
  const sessions = useSessions(project.slug, { active: true })
  const activity = useProjectActivity(project.slug, { limit: '20' })
  const environments = useEnvironments(true)
  const metrics = useMetricsCurrent()
  const known = new Map((environments.data ?? []).map((environment) => [environment.name, environment]))
  const adopted = project.environments.map((entry) => known.get(entry.environment)).filter((environment): environment is Environment => environment !== undefined)
  const measured = (metrics.data?.projects ?? []).filter((entry) => project.environments.some((link) => link.environment === entry.composeProject))
  const cpu = measured.reduce<number | null>((sum, entry) => (entry.cpuUtilisation === null ? sum : (sum ?? 0) + entry.cpuUtilisation), null)
  const memory = measured.reduce<number | null>((sum, entry) => (entry.memoryUsedBytes === null ? sum : (sum ?? 0) + entry.memoryUsedBytes), null)
  const inProgress = (tasks.data ?? []).filter((task) => task.status === 'in_progress')
  const blocked = (tasks.data ?? []).filter((task) => task.status === 'blocked')
  const review = (tasks.data ?? []).filter((task) => task.status === 'review')

  return (
    <div className="space-y-4">
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title={t('overview.development')}
            description={tasks.data ? t('overview.developmentDescription', { open: tasks.data.length, inProgress: inProgress.length, blocked: blocked.length }) : undefined}
            actions={<a className="text-xs text-accent hover:underline" href={`#${tasksHref(project.slug, 'board')}`}>{t('overview.allTasks')}</a>}
          />
          {tasks.isPending ? (
            <Loading />
          ) : tasks.error ? (
            <Empty title={tk('needsDatabase')} />
          ) : (
            <>
              <Section label={tk('status.inProgress')} tasks={inProgress} slug={project.slug} empty={t('overview.nothingInProgress')} />
              <Section label={tk('status.review')} tasks={review} slug={project.slug} />
              <Section label={tk('status.blocked')} tasks={blocked} slug={project.slug} />
              <div className="border-t border-line px-4 py-2 text-sm">
                <span className="text-xs text-subtle">{t('overview.next')}: </span>
                {next.data ? (
                  <a className="underline-offset-2 hover:text-accent hover:underline" href={taskHref(project.slug, next.data.id)}>#{next.data.id} {next.data.title}</a>
                ) : (
                  <span className="text-subtle">{t('overview.nothingNext')}</span>
                )}
              </div>
            </>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title={ts('active', { count: (sessions.data ?? []).length })} />
            {(sessions.data ?? []).length === 0 ? (
              <Empty title={ts('none')} hint={ts('noneHint', { slug: project.slug })} />
            ) : (
              (sessions.data ?? []).map((session) => <SessionRow key={session.id} session={session} />)
            )}
          </Card>
          <Card>
            <CardHeader title={t('overview.resources')} />
            <CardBody>
              {measured.length === 0 ? (
                <p className="text-xs text-subtle">{t('overview.noMeasurement')}</p>
              ) : (
                <ResourceUsage cpu={cpu} memoryBytes={memory} variant="bar" stale={metrics.data?.stale} />
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader title={t('repositoriesCard.title')} description={t('repositoriesCard.description')} actions={<a className="text-xs text-accent hover:underline" href={`#/projects/${encodeURIComponent(project.slug)}/repositories`}>{t('overview.manageRepositories')}</a>} />
        {project.repositories.length === 0 ? (
          <Empty title={t('repositoriesCard.empty')} hint={t('repositoriesCard.emptyHint')} />
        ) : (
          project.repositories.map((repository) => <RepositoryRow key={repository.id} repository={repository} projectSlug={project.slug} density="card" />)
        )}
      </Card>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">{t('environments.title')}</h2>
          <a className="text-xs text-accent hover:underline" href={`#/projects/${encodeURIComponent(project.slug)}/environments`}>{t('overview.manageEnvironments')}</a>
        </div>
        {project.environments.length === 0 ? (
          <Card><Empty title={t('environments.empty')} hint={t('environments.emptyHint')} /></Card>
        ) : adopted.length === 0 ? (
          <Card>
            {project.environments.map((environment) => <AdoptedRow key={environment.environment} environment={environment} />)}
          </Card>
        ) : (
          adopted.map((environment) => <EnvironmentCard key={environment.name} environment={environment} owner={{ slug: project.slug, name: project.name }} readOnly={readOnly} />)
        )}
      </div>

      <Card>
        <CardHeader title={ta('recent')} actions={<a className="text-xs text-accent hover:underline" href={`#/projects/${encodeURIComponent(project.slug)}/activity`}>{ta('all')}</a>} />
        {activity.isPending ? <Loading /> : <ActivityTimeline events={activity.data?.events ?? []} compact />}
      </Card>
    </div>
  )
}

function Section({ label, tasks, slug, empty }: { label: string; tasks: TaskSummary[]; slug: string; empty?: string }) {
  if (tasks.length === 0 && !empty) return null
  return (
    <div>
      <div className="flex items-center gap-2 border-t border-line bg-surface-2/40 px-4 py-1 text-[11px] font-semibold tracking-wider text-subtle uppercase first:border-t-0">
        {label} <Badge tone="outline">{tasks.length}</Badge>
      </div>
      {tasks.length === 0 ? <p className="px-4 py-2 text-xs text-subtle">{empty}</p> : tasks.map((task) => <TaskRow key={task.id} task={task} href={taskHref(slug, task.id)} compact />)}
    </div>
  )
}

function AdoptedRow({ environment }: { environment: ProjectEnvironment }) {
  const { t } = useTranslation('projects')
  const sourceReason = t(sourceKey(environment.source))
  const health = environmentHealth(environment)
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2 text-sm last:border-b-0">
      <a className="font-medium underline-offset-2 hover:text-accent hover:underline" href={`#/environments/${encodeURIComponent(environment.environment)}`}>
        {environment.environment}
      </a>
      <Badge tone={healthTone(health)}>{t('running', { running: environment.runningCount, total: environment.serviceCount })}</Badge>
      {environment.unhealthyCount > 0 ? <Badge tone="danger">{t('detail.unhealthyCount', { count: environment.unhealthyCount })}</Badge> : null}
      <span className="text-xs text-subtle">{sourceReason}</span>
    </div>
  )
}

function RepositoriesTab({ project, readOnly }: { project: Project; readOnly: boolean }) {
  const { t } = useTranslation('projects')
  const { t: tr } = useTranslation('repositories')
  const [attaching, setAttaching] = useState(false)
  return (
    <>
      <Card>
        <CardHeader
          title={t('repositoriesCard.title')}
          description={t('repositoriesCard.description')}
          actions={
            <Button size="sm" disabled={readOnly} onClick={() => setAttaching(true)}>
              <Plus className="h-3.5 w-3.5" />
              {tr('add.button')}
            </Button>
          }
        />
        {project.repositories.length === 0 ? (
          <Empty title={t('repositoriesCard.empty')} hint={t('repositoriesCard.emptyHint')} />
        ) : (
          project.repositories.map((repository) => (
            <RepositoryRow key={repository.id} repository={repository} projectSlug={project.slug} density="card" actions={readOnly ? undefined : <RemoveRepository repository={repository} />} />
          ))
        )}
      </Card>
      {attaching ? <RepositoriesDialog project={project} open onOpenChange={setAttaching} /> : null}
    </>
  )
}

function EnvironmentsTab({ project, readOnly }: { project: Project; readOnly: boolean }) {
  const { t } = useTranslation('projects')
  const queryClient = useQueryClient()
  const environments = useEnvironments(true)
  const [adopting, setAdopting] = useState('')
  const known = new Map((environments.data ?? []).map((environment) => [environment.name, environment]))
  const adoptedNames = new Set(project.environments.map((entry) => entry.environment))
  const candidates = (environments.data ?? []).filter((environment) => !adoptedNames.has(environment.name))
  const adopt = useMutation({
    mutationFn: (name: string) => api.setProjectEnvironments(project.slug, [...project.environments.filter((entry) => entry.source === 'manual').map((entry) => entry.environment), name]),
    onSuccess: () => {
      setAdopting('')
      void queryClient.invalidateQueries({ queryKey: keys.projects() })
    },
  })
  return (
    <div className="space-y-3">
      {!readOnly && candidates.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={adopting} onChange={(event) => setAdopting(event.target.value)} aria-label={t('environments.adopt')} className="h-8 w-56">
            <option value="">{t('environments.adopt')}</option>
            {candidates.map((environment) => <option key={environment.name} value={environment.name}>{environment.name}</option>)}
          </Select>
          <Button size="sm" disabled={adopting === '' || adopt.isPending} onClick={() => adopt.mutate(adopting)}>{t('environments.adoptButton')}</Button>
          {adopt.error ? <ErrorBox error={adopt.error} /> : null}
        </div>
      ) : null}
      {project.environments.length === 0 ? (
        <Card><Empty title={t('environments.empty')} hint={t('environments.emptyHint')} /></Card>
      ) : (
        project.environments.map((entry) => {
          const environment = known.get(entry.environment)
          return environment ? (
            <div key={entry.environment} className="space-y-1">
              <EnvironmentCard environment={environment} owner={{ slug: project.slug, name: project.name }} readOnly={readOnly} />
              <p className="px-1 text-[11px] text-subtle">{t(sourceKey(entry.source))}</p>
            </div>
          ) : (
            <Card key={entry.environment}><AdoptedRow environment={entry} /></Card>
          )
        })
      )}
    </div>
  )
}

function sourceKey(source: ProjectEnvironment['source']): 'detail.sourceReason.repoMatch' | 'detail.sourceReason.label' | 'detail.sourceReason.path' | 'detail.sourceReason.manual' {
  return source === 'repo-match' ? 'detail.sourceReason.repoMatch' : source === 'label' ? 'detail.sourceReason.label' : source === 'path' ? 'detail.sourceReason.path' : 'detail.sourceReason.manual'
}

function ActivityTab({ slug }: { slug: string }) {
  const { t } = useTranslation('activity')
  const [kind, setKind] = useState('')
  const [actor, setActor] = useState('')
  const [before, setBefore] = useState<string | null>(null)
  const [pages, setPages] = useState<string[]>([])
  const filters = { kind: kind || undefined, actor: actor || undefined, limit: '50', before: before ?? undefined }
  const activity = useProjectActivity(slug, filters)
  const events = activity.data?.events ?? []
  return (
    <Card>
      <CardHeader
        title={t('title')}
        description={t('description')}
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <Select value={kind} onChange={(event) => { setKind(event.target.value); setBefore(null); setPages([]) }} className="h-7 w-40" aria-label={t('kindFilter')}>
              <option value="">{t('anyKind')}</option>
              {['task', 'session', 'repository', 'environment', 'service', 'project'].map((entity) => (
                <option key={entity} value={entity}>{t(`entity.${entity}` as 'entity.task')}</option>
              ))}
            </Select>
            <Input value={actor} onChange={(event) => { setActor(event.target.value); setBefore(null); setPages([]) }} placeholder={t('actorFilter')} className="h-7 w-36" aria-label={t('actorFilter')} />
          </div>
        }
      />
      {activity.isPending ? (
        <Loading />
      ) : activity.error ? (
        <ErrorBox error={activity.error} />
      ) : (
        <>
          {pages.length > 0 ? (
            <div className="px-4 pt-2">
              <Button size="sm" onClick={() => { const previous = [...pages]; const last = previous.pop() ?? null; setPages(previous); setBefore(last) }}>{t('newer')}</Button>
            </div>
          ) : null}
          <ActivityTimeline
            events={events}
            showProject={false}
            onLoadMore={activity.data?.nextBefore ? () => { setPages([...pages, before ?? '']); setBefore(activity.data!.nextBefore) } : null}
          />
        </>
      )}
    </Card>
  )
}

function SettingsTab({ project, readOnly }: { project: Project; readOnly: boolean }) {
  const { t } = useTranslation('projects')
  const { t: tc } = useTranslation('common')
  const queryClient = useQueryClient()
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description ?? '')
  const [relativePath, setRelativePath] = useState(project.relativePath ?? '')
  const [archived, setArchived] = useState(project.archived)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [typed, setTyped] = useState('')
  const save = useMutation({
    mutationFn: () => api.patchProject(project.slug, {
      name: name.trim(),
      description: description.trim() === '' ? null : description.trim(),
      relativePath: relativePath.trim() === '' ? null : relativePath.trim(),
      archived,
    }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.projects() }),
  })
  const remove = useMutation({
    mutationFn: () => api.deleteProject(project.slug),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.projects() })
      navigate('/projects')
    },
  })
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title={t('settings.title')} description={t('settings.description')} />
        <CardBody className="space-y-3">
          {save.error ? <ErrorBox error={save.error} /> : null}
          <label className="block">
            <span className="text-xs text-subtle">{t('create.name')}</span>
            <Input value={name} onChange={(event) => setName(event.target.value)} aria-label={t('create.name')} disabled={readOnly} />
          </label>
          <label className="block">
            <span className="text-xs text-subtle">{t('create.descriptionLabel')}</span>
            <Input value={description} onChange={(event) => setDescription(event.target.value)} aria-label={t('create.descriptionLabel')} disabled={readOnly} />
          </label>
          <label className="block">
            <span className="text-xs text-subtle">{t('settings.relativePath')}</span>
            <Input value={relativePath} onChange={(event) => setRelativePath(event.target.value)} aria-label={t('settings.relativePath')} placeholder={project.slug} disabled={readOnly} />
            <span className="mt-0.5 block text-[11px] text-subtle">{t('settings.relativePathHint')}{project.resolvedPath ? ` · ${project.resolvedPath}` : ''}</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={archived} onCheckedChange={setArchived} disabled={readOnly} aria-label={t('settings.archived')} />
            {t('settings.archived')}
          </label>
          <Button size="sm" variant="primary" disabled={readOnly || save.isPending || name.trim() === ''} onClick={() => save.mutate()}>{tc('save')}</Button>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t('settings.deleteTitle')} description={t('settings.deleteDescription')} />
        <CardBody className="space-y-3">
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted">
            <li>{t('settings.deleteRemoves')}</li>
            <li>{t('settings.deleteKeeps')}</li>
          </ul>
          {remove.error ? <ErrorBox error={remove.error} /> : null}
          {confirmDelete ? (
            <div className="space-y-2">
              <label className="block">
                <span className="text-xs text-subtle">{t('settings.typeSlug', { slug: project.slug })}</span>
                <Input value={typed} onChange={(event) => setTyped(event.target.value)} aria-label={t('settings.typeSlug', { slug: project.slug })} />
              </label>
              <div className="flex gap-2">
                <Button size="sm" variant="danger" disabled={typed !== project.slug || remove.isPending} onClick={() => remove.mutate()}>{t('settings.deleteButton')}</Button>
                <Button size="sm" onClick={() => setConfirmDelete(false)}>{tc('cancel')}</Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="danger" disabled={readOnly} onClick={() => setConfirmDelete(true)}>{t('settings.deleteButton')}</Button>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function RemoveRepository({ repository }: { repository: Repository }) {
  const { t } = useTranslation('projects')
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: () => api.deleteRepository(repository.id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.projects() }),
  })
  return (
    <Button size="sm" variant="ghost" disabled={remove.isPending} title={t('repositoriesCard.remove')} onClick={() => remove.mutate()}>
      {t('repositoriesCard.remove')}
    </Button>
  )
}

type AddTab = 'discovered' | 'github' | 'manual'

/**
 * Three ways to add a repository: one the host already scanned, one the
 * GitHub App was granted, or one named by hand. All three become the same
 * row; the scan fills in the Git facts on its next pass.
 */
function RepositoriesDialog({ project, open, onOpenChange }: { project: Project; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation('repositories', { keyPrefix: 'add' })
  const { t: tr } = useTranslation('repositories')
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<AddTab>('discovered')
  const [name, setName] = useState('')
  const [localPath, setLocalPath] = useState('')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [role, setRole] = useState('')
  const discovered = useDiscoveredRepositories(open && tab === 'discovered')
  const granted = useGitHubRepositories()

  const create = useMutation({
    mutationFn: (body: Parameters<typeof api.createRepository>[1]) => api.createRepository(project.slug, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.projects() })
      void queryClient.invalidateQueries({ queryKey: keys.discoveredRepositories() })
      onOpenChange(false)
    },
  })

  const linked = new Set(project.repositories.map((repository) => repository.github?.fullName).filter(Boolean))
  const githubUnavailable = granted.error instanceof ApiError && granted.error.status === 503
  const roleValue = role === '' ? null : role

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('title', { name: project.name })}
      description={t('description')}
      footer={
        tab === 'manual' ? (
          <Button
            variant="primary"
            size="sm"
            disabled={create.isPending || name.trim() === ''}
            onClick={() =>
              create.mutate({
                name: name.trim(),
                role: roleValue,
                localPath: localPath.trim() === '' ? null : localPath.trim(),
                remoteUrl: remoteUrl.trim() === '' ? null : remoteUrl.trim(),
              })
            }
          >
            {t('add')}
          </Button>
        ) : null
      }
    >
      <div role="tablist" aria-label={t('title', { name: project.name })} className="mb-3 flex gap-1 border-b border-line">
        {(['discovered', 'github', 'manual'] as AddTab[]).map((entry) => (
          <button
            key={entry}
            role="tab"
            type="button"
            aria-selected={tab === entry}
            onClick={() => setTab(entry)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${tab === entry ? 'border-accent font-medium text-accent' : 'border-transparent text-muted hover:text-ink'}`}
          >
            {t(`tabs.${entry}`)}
          </button>
        ))}
      </div>
      {create.error ? <ErrorBox error={create.error} /> : null}

      {tab === 'discovered' ? (
        discovered.isPending ? (
          <Loading label={t('discovered.reading')} />
        ) : discovered.error ? (
          <Empty title={t('discovered.unavailable')} />
        ) : (discovered.data ?? []).length === 0 ? (
          <Empty title={t('discovered.empty')} hint={t('discovered.emptyHint')} />
        ) : (
          <ul className="divide-y divide-line/70">
            {(discovered.data ?? []).map((candidate) => (
              <li key={candidate.key} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="font-medium text-ink">{candidate.name}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-subtle" title={candidate.path}>{candidate.relativePath ?? candidate.path}</span>
                {candidate.location ? <Badge tone="outline">{candidate.location}</Badge> : null}
                {candidate.environments.map((environment) => <Badge key={environment} tone="neutral">{environment}</Badge>)}
                <Button size="sm" disabled={create.isPending} onClick={() => create.mutate({ scanKey: candidate.key })}>
                  {t('add')}
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {tab === 'github' ? (
        <>
          <p className="mb-2 text-xs text-muted">{t('github.description')}</p>
          {granted.isPending ? <Loading label={t('github.reading')} /> : null}
          {granted.error ? (
            <Empty title={githubUnavailable ? t('github.unavailable') : t('github.noList')} hint={t('github.hint')} />
          ) : (granted.data ?? []).length === 0 ? (
            <Empty title={t('github.noneGranted')} hint={t('github.noneGrantedHint')} />
          ) : (
            <ul className="divide-y divide-line/70">
              {(granted.data ?? []).map((repository) => (
                <li key={repository.githubId} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="font-medium text-ink">{repository.fullName}</span>
                  {repository.private ? <Badge tone="neutral">{tr('private')}</Badge> : null}
                  <span className="flex-1" />
                  <Button size="sm" disabled={create.isPending || linked.has(repository.fullName)} onClick={() => create.mutate({ githubFullName: repository.fullName })}>
                    {t('add')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}

      {tab === 'manual' ? (
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs text-subtle">{t('manual.name')}</span>
            <Input value={name} onChange={(event) => setName(event.target.value)} aria-label={t('manual.name')} />
          </label>
          <label className="block">
            <span className="text-xs text-subtle">{t('manual.localPath')}</span>
            <Input value={localPath} onChange={(event) => setLocalPath(event.target.value)} placeholder="/srv/projects/shop/api" aria-label={t('manual.localPath')} />
            <span className="mt-0.5 block text-[11px] text-subtle">{t('manual.localPathHint')}</span>
          </label>
          <label className="block">
            <span className="text-xs text-subtle">{t('manual.remoteUrl')}</span>
            <Input value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} placeholder="git@github.com:acme/api.git" aria-label={t('manual.remoteUrl')} />
          </label>
          <label className="block">
            <span className="text-xs text-subtle">{t('manual.role')}</span>
            <Select value={role} onChange={(event) => setRole(event.target.value)} aria-label={t('manual.role')}>
              <option value="">{t('role.none')}</option>
              {['api', 'web', 'mobile', 'services', 'infra', 'docs', 'other'].map((entry) => (
                <option key={entry} value={entry}>{entry}</option>
              ))}
            </Select>
          </label>
        </div>
      ) : null}
    </Dialog>
  )
}

