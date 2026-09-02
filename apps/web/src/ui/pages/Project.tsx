import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { SlidersHorizontal } from 'lucide-react'
import { ProjectActions } from '../components/project-actions.tsx'
import { ProjectOperations } from '../components/project-operations.tsx'
import { api, ApiError } from '../lib/api.ts'
import type { ContainerSummary, Project } from '../../shared/types.ts'
import { Card, CardBody, CardHeader } from '../components/ui/card.tsx'
import { Badge } from '../components/ui/badge.tsx'
import { Button } from '../components/ui/button.tsx'
import { Empty, ErrorBox, KeyValue, Loading, PageHeader, StatTile } from '../components/shell-bits.tsx'
import { Tabs, TabPanel, type TabDefinition } from '../components/ui/tabs.tsx'
import { ContainerDetails } from '../components/container-details.tsx'
import { ServiceEndpoints } from '../components/project-services.tsx'
import { ContainerActions } from '../components/container-actions.tsx'
import { ServiceIcon } from '../components/service-icon.tsx'
import { StateBadge } from '../components/status.tsx'
import { TraefikVerdictRow } from '../components/traefik-verdict.tsx'
import { SharePanel } from '../components/share-panel.tsx'
import { GitDetails } from '../components/git-details.tsx'
import { ProjectSettingsDialog } from '../components/project-settings.tsx'
import { ServiceAlias } from '../components/service-alias.tsx'
import { ProjectLogs } from '../components/project-logs.tsx'
import { Mono } from '../components/copy.tsx'
import { useFormat } from '../lib/use-format.ts'
import { useDocumentTitle } from '../lib/title.ts'
import { navigate } from '../lib/router.ts'
import { useIssueStatuses } from '../i18n/use-issue-statuses.ts'

const TABS = ['overview', 'services', 'git', 'logs'] as const
export type ProjectTab = (typeof TABS)[number]

export function resolveTab(requested: string | null): ProjectTab {
  return TABS.includes(requested as ProjectTab) ? (requested as ProjectTab) : 'overview'
}

export function ProjectPage({ project: name, tab: requested, service }: {
  project: string
  tab: string | null
  service: string | null
}) {
  const { t } = useTranslation('gateway', { keyPrefix: 'project' })
  const tab = resolveTab(requested)
  useDocumentTitle(tab === 'overview' ? null : t(`tabs.${tab}`), name)

  const query = useQuery({
    queryKey: ['project', name],
    queryFn: () => api.project(name),
    retry: false,
  })

  if (query.isPending) return <Loading />

  if (query.error) {
    const missing = query.error instanceof ApiError && query.error.status === 404
    if (!missing) return <ErrorBox error={query.error} />
    return (
      <>
        <PageHeader title={name} />
        <Card>
          <Empty
            title={t('notFound', { name })}
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

  const project = query.data!
  const tabs: TabDefinition[] = TABS.map((id) => ({
    id,
    label: t(`tabs.${id}`),
    href: `/projects/${encodeURIComponent(name)}/${id}`,
  }))

  return (
    <>
      <ProjectHeader project={project} />
      <Tabs tabs={tabs} active={tab} label={`${name} sections`} />
      <TabPanel id={tab}>
        {tab === 'overview' ? <OverviewTab project={project} /> : null}
        {tab === 'services' ? <ServicesTab project={project} /> : null}
        {tab === 'git' ? <GitDetails project={project.name} /> : null}
        {tab === 'logs' ? <ProjectLogs project={project} service={service} /> : null}
      </TabPanel>
    </>
  )
}

function ProjectHeader({ project }: { project: Project }) {
  const { t: tp } = useTranslation('projects')
  const { t: tn } = useTranslation('nav')
  const { uptime } = useFormat()
  const [settingsOpen, setSettingsOpen] = useState(false)

  const shown = project.overrides?.displayName ?? project.name

  return (
    <>
      <PageHeader
        title={shown}
        description={
          [
            project.overrides?.displayName ? tp('derivedName', { name: project.name }) : null,
            project.overrides?.description ?? null,
            project.uptimeSeconds !== null ? tp('up', { time: uptime(project.uptimeSeconds) }) : null,
            project.workingDir,
          ]
            .filter(Boolean)
            .join(' · ') || undefined
        }
        actions={
          <>
            <Button size="sm" onClick={() => navigate('/projects')}>
              {tp('allProjects', { defaultValue: 'All projects' })}
            </Button>
            <Button size="sm" onClick={() => setSettingsOpen(true)}>
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {tn('settings')}
            </Button>
            <ProjectActions project={project} />
            <ProjectOperations project={project} />
          </>
        }
      />
      {settingsOpen ? (
        <ProjectSettingsDialog project={project} open={settingsOpen} onOpenChange={setSettingsOpen} />
      ) : null}
    </>
  )
}

function OverviewTab({ project }: { project: Project }) {
  const { t } = useTranslation('gateway', { keyPrefix: 'project' })
  const { t: tc } = useTranslation('common')
  const { uptime } = useFormat()

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={t('stats.services')}
          value={`${project.runningCount}/${project.serviceCount}`}
          tone={project.runningCount === project.serviceCount ? 'ok' : 'warn'}
          hint={t('stats.running')}
        />
        <StatTile
          label={t('stats.unhealthy')}
          value={project.unhealthyCount}
          tone={project.unhealthyCount > 0 ? 'danger' : undefined}
        />
        <StatTile label={t('stats.routedUrls')} value={project.urls.length} />
        <StatTile
          label={t('stats.uptime')}
          value={project.uptimeSeconds === null ? '—' : uptime(project.uptimeSeconds)}
        />
      </div>

      {project.issue ? <IssueBlock issue={project.issue} /> : null}

      <Card>
        <CardHeader title={t('environment.title')} description={t('environment.description')} />
        <CardBody>
          <dl className="divide-y divide-line/60">
            <KeyValue label={t('environment.hostDirectory')}>
              {project.workingDir ? (
                <Mono value={project.workingDir} />
              ) : (
                <span className="text-subtle">{t('unknown', { defaultValue: 'unknown' })}</span>
              )}
            </KeyValue>
            <KeyValue label={t('environment.integrated')}>
              {project.integrated ? (
                <Badge tone="ok">{t('onGateway', { defaultValue: 'on the gateway' })}</Badge>
              ) : (
                <Badge tone="outline">{t('notRouted', { defaultValue: 'not routed by the gateway' })}</Badge>
              )}
            </KeyValue>
            {project.namespace ? (
              <KeyValue label={t('environment.worktree')}>{project.namespace}</KeyValue>
            ) : null}
            {project.group ? (
              <KeyValue label={t('environment.logicalProject')}>{project.group}</KeyValue>
            ) : null}
            {project.gitRoot ? (
              <KeyValue label={t('environment.gitRoot')}>
                <Mono value={project.gitRoot} />
              </KeyValue>
            ) : null}
            {project.repo ? (
              <KeyValue label={t('environment.repository')}>
                {project.repoUrl ? (
                  <a
                    className="underline-offset-2 hover:text-accent hover:underline"
                    href={project.repoUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {project.repo}
                  </a>
                ) : (
                  project.repo
                )}
              </KeyValue>
            ) : null}
            <KeyValue label={t('environment.networks')}>
              <span className="font-mono text-xs text-muted">
                {project.networks.length > 0 ? project.networks.join(', ') : tc('none', { defaultValue: 'none' })}
              </span>
            </KeyValue>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('endpoints.title')} description={t('endpoints.description')} />
        {project.services.length === 0 ? (
          <Empty title={t('endpoints.empty')} />
        ) : (
          <div>
            {project.services.map((service) => (
              <div
                key={service.id}
                className="grid gap-2 border-b border-line px-4 py-2 last:border-b-0 lg:grid-cols-[minmax(10rem,0.6fr)_1fr] lg:items-start"
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <ServiceIcon tech={service.tech} />
                  <span className="truncate text-sm font-medium">{service.service ?? service.name}</span>
                  <StateBadge state={service.state} health={service.health} />
                </div>
                <ServiceEndpoints service={service} />
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title={t('repository.title')}
          description={t('repository.description')}
          actions={
            <a
              className="text-xs text-accent hover:underline"
              href={`#/projects/${encodeURIComponent(project.name)}/git`}
            >
              {t('openGitTab', { defaultValue: 'Open Git tab' })}
            </a>
          }
        />
        <GitSummary project={project.name} />
      </Card>
    </div>
  )
}

function GitSummary({ project }: { project: string }) {
  const { t } = useTranslation('gateway', { keyPrefix: 'project' })
  const query = useQuery({
    queryKey: ['project-git', project],
    queryFn: () => api.projectGit(project),
    staleTime: 30_000,
  })

  const data = query.data
  if (!data) return <Empty title={t('git.reading')} />
  if (!data.collected || !data.git) {
    return (
      <Empty
        title={t('git.empty')}
        hint={<code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono">{data.refreshCommand}</code>}
      />
    )
  }

  const git = data.git
  const changed = git.staged + git.unstaged + git.untracked + git.unmerged
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs">
      <Badge tone="outline">
        {git.detached ? t('detachedHead', { defaultValue: 'detached HEAD' }) : git.branch}
      </Badge>
      <span className="font-mono text-subtle">{git.head.shortSha}</span>
      <Badge tone={changed > 0 ? 'warn' : 'ok'}>
        {changed > 0
          ? t('uncommitted', { defaultValue: '{{count}} uncommitted', count: changed })
          : t('clean', { defaultValue: 'clean' })}
      </Badge>
      {git.ahead > 0 ? (
        <Badge tone="outline">{t('ahead', { defaultValue: '{{count}} ahead', count: git.ahead })}</Badge>
      ) : null}
      {git.behind > 0 ? (
        <Badge tone="outline">{t('behind', { defaultValue: '{{count}} behind', count: git.behind })}</Badge>
      ) : null}
      {data.forge?.authenticated ? (
        <Badge tone="outline">
          {t('openPullRequests', {
            defaultValue: '{{count}} open pull requests',
            count: data.forge.pulls.length,
          })}
        </Badge>
      ) : null}
    </div>
  )
}

function ServicesTab({ project }: { project: Project }) {
  const { t } = useTranslation('gateway', { keyPrefix: 'project' })
  const [details, setDetails] = useState<ContainerSummary | null>(null)

  if (project.services.length === 0) {
    return (
      <Card>
        <Empty title={t('servicesEmpty')} hint={t('servicesEmptyHint')} />
      </Card>
    )
  }

  return (
    <>
      <div className="space-y-4">
        {project.services.map((service) => (
          <ServiceDetailCard
            key={service.id}
            project={project}
            service={service}
            onShowDetails={() => setDetails(service)}
          />
        ))}
      </div>
      {details ? (
        <ContainerDetails
          container={details}
          open={details !== null}
          onOpenChange={(open) => !open && setDetails(null)}
        />
      ) : null}
    </>
  )
}

function ServiceDetailCard({
  project,
  service,
  onShowDetails,
}: {
  project: Project
  service: ContainerSummary
  onShowDetails: () => void
}) {
  const { t } = useTranslation('gateway', { keyPrefix: 'project' })
  const { t: tc } = useTranslation('common')
  const { shortImage } = useFormat()
  const name = service.service ?? service.name
  const primary = project.overrides?.primaryService === name
  const collapsed = project.overrides?.hiddenServices?.includes(name) ?? false

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <ServiceIcon tech={service.tech} />
            <span>{name}</span>
            <StateBadge state={service.state} health={service.health} />
            {service.restartCount > 0 ? (
              <Badge tone={service.restartCount > 3 ? 'danger' : 'warn'}>
                {t('restarts', { defaultValue: '{{count}} restarts', count: service.restartCount })}
              </Badge>
            ) : null}
            {service.state !== 'running' && service.exitCode !== null ? (
              <Badge tone="danger">
                {t('exitCode', { defaultValue: 'exit {{code}}', code: service.exitCode })}
              </Badge>
            ) : null}
            {primary ? <Badge tone="accent">{t('primary', { defaultValue: 'primary' })}</Badge> : null}
            {collapsed ? (
              <Badge tone="outline">{t('collapsedInList', { defaultValue: 'collapsed in the list' })}</Badge>
            ) : null}
          </span>
        }
        description={
          [service.overrides?.note, `${shortImage(service.image)} · ${service.name}`]
            .filter(Boolean)
            .join(' · ')
        }
        actions={<ContainerActions container={service} onShowDetails={onShowDetails} />}
      />
      <CardBody>
        <dl className="divide-y divide-line/60">
          <KeyValue label={tc('container.endpoints')}>
            <ServiceEndpoints service={service} />
          </KeyValue>
          <KeyValue label={tc('container.containerPorts')}>
            <span className="font-mono text-xs text-muted">
              {service.exposedPorts.length > 0
                ? service.exposedPorts.join(', ')
                : t('noneExposed', { defaultValue: 'none exposed' })}
            </span>
          </KeyValue>
          {service.ports.length > 0 ? (
            <KeyValue label={tc('container.publishedPorts')}>
              <div className="space-y-0.5 font-mono text-xs text-muted">
                {service.ports.map((port) => (
                  <div key={`${port.ip}:${port.hostPort}`}>
                    {port.ip}:{port.hostPort} → {port.containerPort}/{port.protocol}
                  </div>
                ))}
              </div>
            </KeyValue>
          ) : null}
          <KeyValue label={tc('container.networks')}>
            <span className="font-mono text-xs text-muted">
              {service.networks.length > 0 ? service.networks.join(', ') : tc('none', { defaultValue: 'none' })}
            </span>
          </KeyValue>
          {service.mounts.length > 0 ? (
            <KeyValue label={tc('container.mounts')}>
              <div className="space-y-0.5 font-mono text-xs text-muted">
                {service.mounts.map((mount) => (
                  <div key={mount.destination}>
                    {mount.type}: {mount.name ?? mount.source} → {mount.destination}
                    {mount.rw ? '' : ' (ro)'}
                  </div>
                ))}
              </div>
            </KeyValue>
          ) : null}
          {service.urls.length > 0 ? (
            <KeyValue label={tc('container.traefik')}>
              <TraefikVerdictRow container={service} enabled />
            </KeyValue>
          ) : null}
          {service.urls.length > 0 ? (
            <KeyValue label={tc('container.exposure')}>
              <SharePanel container={service} />
            </KeyValue>
          ) : null}
          {service.kind === 'http' ? (
            <KeyValue label={tc('container.hostnameAlias')}>
              <ServiceAlias project={project.name} service={service} />
            </KeyValue>
          ) : null}
        </dl>
      </CardBody>
    </Card>
  )
}

function IssueBlock({ issue }: { issue: NonNullable<Project['issue']> }) {
  const { statusLabel, priorityLabel } = useIssueStatuses()
  const { t: ti } = useTranslation('issues')

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="outline">{issue.repository}</Badge>
            <a
              className="underline-offset-2 hover:text-accent hover:underline"
              href={issue.htmlUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              #{issue.number}
            </a>
            <span className="min-w-0 truncate">{issue.title}</span>
            {issue.issueType ? <Badge tone="neutral">{issue.issueType}</Badge> : null}
            {issue.status ? <Badge tone="accent">{statusLabel(issue.status)}</Badge> : null}
            {issue.priority ? (
              <Badge tone="warn">{priorityLabel(issue.priority)}</Badge>
            ) : null}
            {issue.state === 'closed' ? (
              <Badge tone="ok">{ti('state.closed')}</Badge>
            ) : null}
          </span>
        }
        description={issue.reason}
      />
    </Card>
  )
}
