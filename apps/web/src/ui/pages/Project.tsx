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
import { Badge, StatusIndicator } from '../components/ui/badge.tsx'
import { Button } from '../components/ui/button.tsx'
import { Card, CardBody, CardHeader, CardSection } from '../components/ui/card.tsx'
import { Dialog } from '../components/ui/dialog.tsx'
import { Field, Input, Select } from '../components/ui/field.tsx'
import { Switch } from '../components/ui/switch.tsx'
import { Tabs, TabPanel } from '../components/ui/tabs.tsx'
import { RepositoryRow } from '../components/entities/repository-row.tsx'
import { EnvironmentCard } from '../components/entities/environment-card.tsx'
import { EnvironmentOpenMenu } from '../components/entities/open-test-menu.tsx'
import { ResourceUsage } from '../components/entities/resource-usage.tsx'
import { SessionRow } from '../components/entities/session-row.tsx'
import { ActivityTimeline } from '../components/entities/activity-timeline.tsx'
import { TaskRow } from '../components/entities/task-row.tsx'
import { TasksTab } from '../components/tasks/tasks-view.tsx'
import { useKickCreate } from '../lib/kick-create.ts'
import { Empty, ErrorBox, Loading, PageHeader, SectionHeader } from '../components/shell-bits.tsx'
import { Mono } from '../components/copy.tsx'
import { cn } from '../lib/utils.ts'
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
  const kickCreate = useKickCreate(slug)

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
      <ProjectHeader project={data} readOnly={readOnly} onNewTask={() => kickCreate.mutate()} creating={kickCreate.isPending} />
      <Tabs label={t('tabs.label', { name: data.name })} active={tab} tabs={tabs} />
      <TabPanel id={tab}>
        {tab === 'overview' ? <OverviewTab project={data} readOnly={readOnly} /> : null}
        {tab === 'tasks' ? <TasksTab project={data} view={resolveTaskView(params.get('view'))} filters={taskFiltersFrom(params)} readOnly={readOnly} /> : null}
        {tab === 'repositories' ? <RepositoriesTab project={data} readOnly={readOnly} /> : null}
        {tab === 'environments' ? <EnvironmentsTab project={data} readOnly={readOnly} /> : null}
        {tab === 'activity' ? <ActivityTab slug={slug} /> : null}
        {tab === 'settings' ? <SettingsTab project={data} readOnly={readOnly} /> : null}
      </TabPanel>
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

function ProjectHeader({ project, readOnly, onNewTask, creating = false }: { project: Project; readOnly: boolean; onNewTask: () => void; creating?: boolean }) {
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
      description={project.description ?? undefined}
      meta={
        <>
          {project.archived ? <Badge tone="outline">{t('archived')}</Badge> : null}
          {project.environments.length > 0 ? (
            <StatusIndicator tone={unhealthy > 0 ? 'danger' : running > 0 ? 'ok' : 'neutral'}>
              {t('running', { running, total: project.environments.length })}
              {unhealthy > 0 ? ` · ${t('pulse.unhealthy', { count: unhealthy })}` : ''}
            </StatusIndicator>
          ) : null}
          {tasks.data ? <StatusIndicator tone={inProgress > 0 ? 'info' : 'neutral'}>{t('pulse.tasks', { open, inProgress })}</StatusIndicator> : null}
          {active > 0 ? <StatusIndicator tone="agent" pulse>{t('pulse.sessions', { count: active })}</StatusIndicator> : null}
        </>
      }
      actions={
        <>
          {primary ? <EnvironmentOpenMenu environment={primary} /> : null}
          <Button size="sm" variant="primary" disabled={readOnly || creating} onClick={onNewTask}>
            <Plus className="size-3.5" />
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
            actions={<a className="rounded-xs text-xs text-accent hover:underline focus-ring" href={`#${tasksHref(project.slug, 'board')}`}>{t('overview.allTasks')}</a>}
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
              <div className="flex h-9 items-center gap-1.5 border-t border-line px-3 text-sm">
                <span className="text-xs text-subtle">{t('overview.next')}: </span>
                {next.data ? (
                  <a className="min-w-0 truncate rounded-xs underline-offset-2 hover:underline focus-ring" href={taskHref(project.slug, next.data.id)}>#{next.data.id} {next.data.title}</a>
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
        <CardHeader title={t('repositoriesCard.title')} description={t('repositoriesCard.description')} actions={<a className="rounded-xs text-xs text-accent hover:underline focus-ring" href={`#/projects/${encodeURIComponent(project.slug)}/repositories`}>{t('overview.manageRepositories')}</a>} />
        {project.repositories.length === 0 ? (
          <Empty title={t('repositoriesCard.empty')} hint={t('repositoriesCard.emptyHint')} />
        ) : (
          project.repositories.map((repository) => <RepositoryRow key={repository.id} repository={repository} projectSlug={project.slug} density="card" />)
        )}
      </Card>

      <div className="space-y-3">
        <SectionHeader
          title={t('environments.title')}
          actions={<a className="rounded-xs text-xs text-accent hover:underline focus-ring" href={`#/projects/${encodeURIComponent(project.slug)}/environments`}>{t('overview.manageEnvironments')}</a>}
        />
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
        <CardHeader title={ta('recent')} actions={<a className="rounded-xs text-xs text-accent hover:underline focus-ring" href={`#/projects/${encodeURIComponent(project.slug)}/activity`}>{ta('all')}</a>} />
        {activity.isPending ? <Loading /> : <ActivityTimeline events={activity.data?.events ?? []} compact />}
      </Card>
    </div>
  )
}

function Section({ label, tasks, slug, empty }: { label: string; tasks: TaskSummary[]; slug: string; empty?: string }) {
  if (tasks.length === 0 && !empty) return null
  return (
    <CardSection label={label} count={tasks.length}>
      {tasks.length === 0 ? <p className="px-3 py-2 text-xs text-subtle">{empty}</p> : tasks.map((task) => <TaskRow key={task.id} task={task} href={taskHref(slug, task.id)} compact />)}
    </CardSection>
  )
}

/**
 * The adopted environment when the list does not carry it in full. One with no
 * services at all is a remembered one (its containers are gone), which the
 * link carries no presence for: "0/0 running" would be the wrong word.
 */
function AdoptedRow({ environment }: { environment: ProjectEnvironment }) {
  const { t } = useTranslation('projects')
  const { t: te } = useTranslation('environments')
  const sourceReason = t(sourceKey(environment.source))
  const health = environmentHealth(environment)
  const remembered = environment.serviceCount === 0 && !environment.running
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-2 border-b border-line-subtle px-3 py-1.5 text-sm last:border-b-0 hover:bg-fill">
      <a className="rounded-xs font-medium underline-offset-2 hover:underline focus-ring" href={`#/environments/${encodeURIComponent(environment.environment)}`}>
        {environment.environment}
      </a>
      {remembered ? (
        <Badge tone="outline">{te('presence.remembered')}</Badge>
      ) : (
        <StatusIndicator tone={healthTone(health)}>{t('running', { running: environment.runningCount, total: environment.serviceCount })}</StatusIndicator>
      )}
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
              <Plus className="size-3.5" />
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
          <Select value={adopting} onChange={(event) => setAdopting(event.target.value)} aria-label={t('environments.adopt')} size="sm" className="w-56">
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
              <p className="px-1 text-2xs text-subtle">{t(sourceKey(entry.source))}</p>
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
            <Select value={kind} onChange={(event) => { setKind(event.target.value); setBefore(null); setPages([]) }} size="sm" className="w-40" aria-label={t('kindFilter')}>
              <option value="">{t('anyKind')}</option>
              {['task', 'session', 'repository', 'environment', 'service', 'project'].map((entity) => (
                <option key={entity} value={entity}>{t(`entity.${entity}` as 'entity.task')}</option>
              ))}
            </Select>
            <Input value={actor} onChange={(event) => { setActor(event.target.value); setBefore(null); setPages([]) }} placeholder={t('actorFilter')} size="sm" className="w-36" aria-label={t('actorFilter')} />
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
            <div className="px-3 pt-2">
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
          <Field label={t('create.name')}>
            {(id) => <Input id={id} value={name} onChange={(event) => setName(event.target.value)} aria-label={t('create.name')} disabled={readOnly} />}
          </Field>
          <Field label={t('create.descriptionLabel')}>
            {(id) => <Input id={id} value={description} onChange={(event) => setDescription(event.target.value)} aria-label={t('create.descriptionLabel')} disabled={readOnly} />}
          </Field>
          <Field
            label={t('settings.relativePath')}
            hint={<>{t('settings.relativePathHint')}{project.resolvedPath ? <> · <Mono kind="path" tone="subtle">{project.resolvedPath}</Mono></> : null}</>}
          >
            {(id) => <Input id={id} mono value={relativePath} onChange={(event) => setRelativePath(event.target.value)} aria-label={t('settings.relativePath')} placeholder={project.slug} disabled={readOnly} />}
          </Field>
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
              <Field label={t('settings.typeSlug', { slug: project.slug })}>
                {(id) => <Input id={id} mono value={typed} onChange={(event) => setTyped(event.target.value)} aria-label={t('settings.typeSlug', { slug: project.slug })} />}
              </Field>
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
      <div role="tablist" aria-label={t('title', { name: project.name })} className="mb-3 flex gap-0.5 border-b border-line">
        {(['discovered', 'github', 'manual'] as AddTab[]).map((entry) => (
          <button
            key={entry}
            role="tab"
            type="button"
            aria-selected={tab === entry}
            onClick={() => setTab(entry)}
            className={cn(
              'relative flex h-9 items-center px-2.5 text-sm font-medium transition-colors duration-100 focus-ring-inset',
              'after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full',
              tab === entry ? 'text-ink after:bg-accent' : 'text-subtle after:bg-transparent hover:text-ink',
            )}
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
          <ul className="divide-y divide-line-subtle">
            {(discovered.data ?? []).map((candidate) => (
              <li key={candidate.key} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
                <span className="font-medium text-ink">{candidate.name}</span>
                <Mono kind="path" tone="subtle" className="flex-1 text-xs" title={candidate.path}>{candidate.relativePath ?? candidate.path}</Mono>
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
            <ul className="divide-y divide-line-subtle">
              {(granted.data ?? []).map((repository) => (
                <li key={repository.githubId} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
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
          <Field label={t('manual.name')}>
            {(id) => <Input id={id} value={name} onChange={(event) => setName(event.target.value)} aria-label={t('manual.name')} />}
          </Field>
          <Field label={t('manual.localPath')} hint={t('manual.localPathHint')}>
            {(id) => <Input id={id} mono value={localPath} onChange={(event) => setLocalPath(event.target.value)} placeholder="/srv/projects/shop/api" aria-label={t('manual.localPath')} />}
          </Field>
          <Field label={t('manual.remoteUrl')}>
            {(id) => <Input id={id} mono value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} placeholder="git@github.com:acme/api.git" aria-label={t('manual.remoteUrl')} />}
          </Field>
          <Field label={t('manual.role')}>
            {(id) => (
              <Select id={id} value={role} onChange={(event) => setRole(event.target.value)} aria-label={t('manual.role')} className="w-full">
                <option value="">{t('role.none')}</option>
                {['api', 'web', 'mobile', 'services', 'infra', 'docs', 'other'].map((entry) => (
                  <option key={entry} value={entry}>{entry}</option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      ) : null}
    </Dialog>
  )
}
