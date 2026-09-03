import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../lib/api/index.ts'
import { useEnvironment, useEnvironmentGit, useEnvironmentOwners, useEnvironmentServices } from '../lib/queries/index.ts'
import type { EnvironmentOwner } from '../lib/queries/projects.ts'
import { environmentHealth, healthTone } from '../lib/health.ts'
import { serviceRowsFor } from '../lib/services.ts'
import { useFormat } from '../lib/use-format.ts'
import { useDocumentTitle } from '../lib/title.ts'
import { navigate } from '../lib/router.ts'
import type { Environment } from '../../shared/types.ts'
import { Badge } from '../components/ui/badge.tsx'
import { Card, CardBody, CardHeader } from '../components/ui/card.tsx'
import { Tabs, TabPanel, type TabDefinition } from '../components/ui/tabs.tsx'
import { Empty, ErrorBox, Loading, PageHeader } from '../components/shell-bits.tsx'
import type { BreadcrumbItem } from '../components/ui/breadcrumb.tsx'
import { EnvironmentActions } from '../components/environment-actions.tsx'
import { EnvironmentOperations } from '../components/environment-operations.tsx'
import { EnvironmentLogs } from '../components/environment-logs.tsx'
import { EnvironmentSettingsForm } from '../components/environment-settings.tsx'
import { GitStatusLine } from '../components/entities/git-status-line.tsx'
import { EnvironmentOpenMenu } from '../components/entities/open-test-menu.tsx'
import { ResourceUsage } from '../components/entities/resource-usage.tsx'
import { ServiceTable } from '../components/entities/service-table.tsx'
import { repositoryHref } from '../components/entities/repository-row.tsx'
import { useTaskStatuses } from '../i18n/use-task-statuses.ts'
import { Mono } from '../components/copy.tsx'

const TABS = ['overview', 'logs', 'settings'] as const
export type EnvironmentTab = (typeof TABS)[number]

/** `services` and `git` were tabs once; they are the overview and the repository now. */
export function resolveTab(requested: string | null): EnvironmentTab {
  return TABS.includes(requested as EnvironmentTab) ? (requested as EnvironmentTab) : 'overview'
}

export function EnvironmentPage({ project: name, tab: requested, service }: {
  project: string
  tab: string | null
  service: string | null
}) {
  const { t } = useTranslation('environments')
  const tab = resolveTab(requested)
  const query = useEnvironment(name)
  // The Project that owns this environment, when one does: the last crumb
  // before the name, and the last part of the document title.
  const { owners } = useEnvironmentOwners()
  const owner = owners.get(name) ?? null
  useDocumentTitle(tab === 'overview' ? null : t(`tabs.${tab}`), name, owner?.name)

  if (requested === 'services') return <Redirect to={`/environments/${encodeURIComponent(name)}`} />
  if (requested === 'git') return <RepositoryRedirect name={name} />

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
            hint={<a className="text-accent hover:underline" href="#/environments">{t('backToAll')}</a>}
          />
        </Card>
      </>
    )
  }

  const environment = query.data!
  const tabs: TabDefinition[] = TABS.map((id) => ({
    id,
    label: t(`tabs.${id}`),
    href: `/environments/${encodeURIComponent(name)}/${id}`,
  }))

  return (
    <>
      <EnvironmentHeader environment={environment} owner={owner} />
      <Tabs tabs={tabs} active={tab} label={`${name} sections`} />
      <TabPanel id={tab}>
        {tab === 'overview' ? <OverviewTab environment={environment} service={service} /> : null}
        {tab === 'logs' ? <EnvironmentLogs project={environment} service={service} /> : null}
        {tab === 'settings' ? (
          <Card>
            <CardHeader title={t('settings.title')} description={t('settings.description')} />
            <CardBody>
              <EnvironmentSettingsForm project={environment} />
            </CardBody>
          </Card>
        ) : null}
      </TabPanel>
    </>
  )
}

function Redirect({ to }: { to: string }) {
  useEffect(() => { navigate(to) }, [to])
  return <Loading />
}

/**
 * The old Git tab. Its facts live on the repository page now; when the panel
 * can tell which repository this environment runs from, that is where it
 * goes, otherwise back to the overview, where the status line still is.
 */
function RepositoryRedirect({ name }: { name: string }) {
  const { owners, isPending } = useEnvironmentOwners()
  useEffect(() => {
    if (isPending) return
    const owner = owners.get(name)
    navigate(owner?.repository ? repositoryHref(owner.slug, owner.repository.id) : `/environments/${encodeURIComponent(name)}`)
  }, [isPending, owners, name])
  return <Loading />
}

function EnvironmentHeader({ environment, owner }: { environment: Environment; owner: EnvironmentOwner | null }) {
  const { t } = useTranslation('environments')
  const { t: tn } = useTranslation('nav')
  const { uptime } = useFormat()
  const git = useEnvironmentGit(environment.name)
  const health = environmentHealth(environment)
  const shown = environment.overrides?.displayName ?? environment.name
  const breadcrumb: BreadcrumbItem[] = owner
    ? [
        { label: tn('projects'), href: '#/projects' },
        { label: owner.name, href: `#/projects/${encodeURIComponent(owner.slug)}` },
        { label: tn('environments'), href: `#/projects/${encodeURIComponent(owner.slug)}/environments` },
        { label: shown },
      ]
    : [{ label: tn('environments'), href: '#/environments' }, { label: shown }]

  return (
    <>
      <PageHeader
        title={shown}
        breadcrumb={breadcrumb}
        description={
          [
            environment.overrides?.displayName ? t('derivedName', { name: environment.name }) : null,
            environment.overrides?.description ?? null,
            environment.uptimeSeconds !== null ? t('up', { time: uptime(environment.uptimeSeconds) }) : null,
            environment.workingDir,
          ]
            .filter(Boolean)
            .join(' · ') || undefined
        }
        actions={
          <>
            <EnvironmentOpenMenu environment={environment} />
            <EnvironmentActions project={environment} />
            <EnvironmentOperations project={environment} />
          </>
        }
      />
      <div className="mb-4 rounded-lg border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-xs">
          <Badge tone={healthTone(health)}>{t('header.services', { running: environment.runningCount, total: environment.serviceCount })}</Badge>
          {environment.unhealthyCount > 0 ? <Badge tone="danger">{t('unhealthy', { count: environment.unhealthyCount })}</Badge> : null}
          {owner ? (
            owner.repository ? (
              <a className="text-accent underline-offset-2 hover:underline" href={repositoryHref(owner.slug, owner.repository.id)}>
                {t('header.openRepository')}: {owner.repository.name}
              </a>
            ) : null
          ) : environment.group ? (
            <Badge tone="outline">{t('partOf', { group: environment.group })}</Badge>
          ) : (
            <span className="text-subtle">{t('header.noProject')}</span>
          )}
          {environment.namespace ? <Badge tone="outline">{t('worktree', { name: environment.namespace })}</Badge> : null}
          {environment.repoUrl ? (
            <a className="text-muted underline-offset-2 hover:text-accent hover:underline" href={environment.repoUrl} target="_blank" rel="noreferrer noopener">{environment.repo}</a>
          ) : null}
          <span className="ml-auto font-mono text-subtle">{environment.networks.join(', ')}</span>
        </div>
        {git.data ? <GitStatusLine git={git.data} variant="line" className="border-t border-line" /> : null}
        {environment.task ? <TaskLine task={environment.task} /> : environment.issue ? <IssueLine issue={environment.issue} /> : null}
      </div>
    </>
  )
}

function TaskLine({ task }: { task: NonNullable<Environment['task']> }) {
  const { t } = useTranslation('environments')
  const { statusLabel, priorityLabel } = useTaskStatuses()
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2 text-xs">
      <span className="text-subtle">{t('header.task')}</span>
      <a className="font-medium text-ink underline-offset-2 hover:text-accent hover:underline" href={task.panelUrl}>#{task.id} {task.title}</a>
      <Badge tone="accent">{statusLabel(task.status)}</Badge>
      {task.priority ? <Badge tone="warn">{priorityLabel(task.priority)}</Badge> : null}
      {task.agent ? <Badge tone="outline">{task.agent}</Badge> : task.assignee ? <Badge tone="outline">{task.assignee}</Badge> : null}
      {task.github ? (
        <a className="text-muted underline-offset-2 hover:text-accent hover:underline" href={task.github.htmlUrl} target="_blank" rel="noreferrer noopener">
          {task.github.repository}#{task.github.number}
        </a>
      ) : null}
      <span className="text-subtle">{task.reason}</span>
    </div>
  )
}

function IssueLine({ issue }: { issue: NonNullable<Environment['issue']> }) {
  const { t } = useTranslation('environments')
  const { statusLabel, priorityLabel } = useTaskStatuses()
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2 text-xs">
      <span className="text-subtle">{t('header.task')}</span>
      <Badge tone="outline">{issue.repository}</Badge>
      <a className="underline-offset-2 hover:text-accent hover:underline" href={issue.htmlUrl} target="_blank" rel="noreferrer noopener">#{issue.number}</a>
      <span className="min-w-0 truncate font-medium text-ink">{issue.title}</span>
      {issue.status ? <Badge tone="accent">{statusLabel(issue.status)}</Badge> : null}
      {issue.priority ? <Badge tone="warn">{priorityLabel(issue.priority)}</Badge> : null}
      <span className="text-subtle">{issue.reason}</span>
    </div>
  )
}

function OverviewTab({ environment, service }: { environment: Environment; service: string | null }) {
  const { t } = useTranslation('environments')
  const served = useEnvironmentServices(environment.name)
  const rows = serviceRowsFor(environment, served.data?.services ?? null)
  const summary = served.data?.resources ?? null
  const base = `/environments/${encodeURIComponent(environment.name)}`

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={t('tabs.overview')}
          description={served.error ? t('servicesTable.fallback') : undefined}
          actions={
            summary ? (
              <ResourceUsage cpu={summary.cpuUtilisation} memoryBytes={summary.memoryUsedBytes} memoryLimitBytes={summary.memoryLimitBytes} diskBytes={summary.diskBytes} stale={summary.stale} />
            ) : null
          }
        />
        {served.isPending && rows.length === 0 ? <Loading /> : (
          <ServiceTable
            services={rows}
            containers={environment.services}
            initialService={service}
            onSelect={(next) => navigate(next ? `${base}?service=${encodeURIComponent(next)}` : base)}
            emptyTitle={t('servicesTable.empty')}
            emptyHint={t('servicesEmptyHint')}
          />
        )}
      </Card>
      {environment.workingDir || environment.gitRoot ? (
        <div className="px-1 text-xs text-subtle">
          {environment.workingDir ? <Mono value={environment.workingDir} /> : null}
          {environment.gitRoot && environment.gitRoot !== environment.workingDir ? <span> · {t('environment.gitRoot')}: <Mono value={environment.gitRoot} /></span> : null}
        </div>
      ) : null}
    </div>
  )
}
