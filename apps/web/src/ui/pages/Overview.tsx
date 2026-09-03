import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { ApiError } from '../lib/api/index.ts'
import { useDevelopmentOverview, useEnvironments, useMetricsCurrent, useMetricsHistory, useStatus } from '../lib/queries/index.ts'
import type { DevelopmentOverview } from '../../shared/overview-types.ts'
import { navigate } from '../lib/router.ts'
import { Card, CardBody, CardHeader } from '../components/ui/card.tsx'
import { Badge } from '../components/ui/badge.tsx'
import { Button } from '../components/ui/button.tsx'
import { Empty, ErrorBox, Loading, PageHeader } from '../components/shell-bits.tsx'
import { DiagnosticText } from '../components/diagnostic-text.tsx'
import { HostResourcesCard } from '../components/host-resources.tsx'
import { EnvironmentActions } from '../components/environment-actions.tsx'
import { CommitRow } from '../components/entities/commit-row.tsx'
import { ProjectRow } from '../components/entities/project-card.tsx'
import { ResourceUsage } from '../components/entities/resource-usage.tsx'
import { SessionRow } from '../components/entities/session-row.tsx'
import { TaskRow } from '../components/entities/task-row.tsx'
import { taskHref } from '../lib/tasks.ts'
import { useDocumentTitle } from '../lib/title.ts'

/**
 * What is happening: the work, who is on it, what needs attention, what
 * changed, and whether this host has room. Infrastructure has its own pages;
 * this one answers the question a person asks when they open the panel.
 */
export function Overview() {
  const { t } = useTranslation('overview')
  useDocumentTitle(t('title'))
  const overview = useDevelopmentOverview()
  const status = useStatus()

  if (overview.isPending && status.isPending) return <Loading label={t('reading')} />

  if (overview.error) {
    const code = overview.error instanceof ApiError ? overview.error.status : null
    if (code === 503 || code === 404) return <ReducedOverview reason={code} />
    return <ErrorBox error={overview.error} />
  }
  if (!overview.data) return <Loading label={t('reading')} />

  return <Dashboard data={overview.data} />
}

function Dashboard({ data }: { data: DevelopmentOverview }) {
  const { t } = useTranslation('overview')
  const { t: tk } = useTranslation('tasks')
  const { t: ts } = useTranslation('sessions')
  const failures = data.gateway.problems.filter((problem) => problem.status === 'fail')
  const work = data.work

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <button type="button" className="flex items-center gap-2 text-sm" onClick={() => navigate('/gateway')}>
            <Badge tone={data.gateway.up ? 'ok' : 'danger'}>{data.gateway.up ? t('gatewayRunning') : t('gatewayDown')}</Badge>
            <Badge tone={failures.length > 0 ? 'danger' : data.gateway.problems.length > 0 ? 'warn' : 'ok'}>
              {t('problems', { count: data.gateway.problems.length })}
            </Badge>
          </button>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title={t('work.title')}
            description={t('work.description', { open: work.counts.open, inProgress: work.counts.inProgress, review: work.counts.review, blocked: work.counts.blocked })}
          />
          {work.counts.open === 0 ? (
            <Empty title={t('work.empty')} hint={t('work.emptyHint')} />
          ) : (
            <>
              <WorkSection label={tk('status.inProgress')} tasks={work.inProgress} empty={t('work.nothingInProgress')} />
              <WorkSection label={tk('status.review')} tasks={work.review} />
              <WorkSection label={tk('status.blocked')} tasks={work.blocked} />
            </>
          )}
        </Card>

        <Card>
          <CardHeader title={ts('active', { count: data.sessions.length })} description={t('sessions.description')} />
          {data.sessions.length === 0 ? (
            <Empty title={ts('noneAnywhere')} hint={ts('noneAnywhereHint')} />
          ) : (
            data.sessions.map((session) => <SessionRow key={session.id} session={session} showProject />)
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title={t('attention.title')} description={t('attention.description')} actions={<Button size="sm" onClick={() => navigate('/gateway')}>{t('attention.diagnostics')}</Button>} />
        {data.attention.length === 0 ? (
          <CardBody>
            <div className="flex items-center gap-2 text-sm text-ok">
              <CheckCircle2 className="h-4 w-4" />
              {t('attention.none')}
            </div>
          </CardBody>
        ) : (
          <ul className="divide-y divide-line/70">
            {data.attention.map((item, index) => (
              <li key={`${item.kind}-${index}`} className="flex items-center gap-2.5 px-4 py-2 text-sm">
                {item.severity === 'fail' ? <XCircle className="h-4 w-4 shrink-0 text-danger" /> : <AlertTriangle className="h-4 w-4 shrink-0 text-warn" />}
                <a className="min-w-0 flex-1 text-ink underline-offset-2 hover:text-accent hover:underline" href={item.href}>{item.summary}</a>
                {item.project ? <Badge tone="outline">{item.project}</Badge> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('projects.title')} actions={<a className="text-xs text-accent hover:underline" href="#/projects">{t('projects.all')}</a>} />
          {data.projects.length === 0 ? (
            <Empty title={t('projects.empty')} hint={t('projects.emptyHint')} />
          ) : (
            data.projects.filter((pulse) => !pulse.archived).slice(0, 8).map((pulse) => <ProjectRow key={pulse.slug} item={{ kind: 'pulse', pulse }} />)
          )}
        </Card>

        <Card>
          <CardHeader title={t('code.title')} description={t('code.description')} />
          {data.code.dirtyRepositories.length > 0 ? (
            <ul className="divide-y divide-line/70 border-b border-line">
              {data.code.dirtyRepositories.map((repository) => (
                <li key={repository.id} className="flex flex-wrap items-center gap-2 px-4 py-1.5 text-sm">
                  <a className="font-medium underline-offset-2 hover:text-accent hover:underline" href={`#/projects/${encodeURIComponent(repository.project)}/repositories/${encodeURIComponent(repository.id)}`}>{repository.name}</a>
                  <span className="font-mono text-[11px] text-subtle">{repository.branch ?? '—'}</span>
                  {repository.changed > 0 ? <Badge tone="warn">{t('code.uncommitted', { count: repository.changed })}</Badge> : null}
                  {repository.ahead > 0 ? <Badge tone="outline">↑{repository.ahead}</Badge> : null}
                  {repository.behind > 0 ? <Badge tone="outline">↓{repository.behind}</Badge> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {data.code.recentCommits.length === 0 ? (
            <Empty title={t('code.empty')} hint={t('code.emptyHint')} />
          ) : (
            <ul>
              {data.code.recentCommits.map((commit) => (
                <li key={`${commit.repository.id}-${commit.sha}`} className="flex items-center gap-2 px-4 text-sm">
                  <a className="w-20 shrink-0 truncate text-xs text-muted hover:text-accent" href={`#/projects/${encodeURIComponent(commit.project)}/repositories/${encodeURIComponent(commit.repository.id)}/commits`}>{commit.repository.name}</a>
                  <CommitRow commit={{ sha: commit.sha, shortSha: commit.shortSha, subject: commit.subject, author: commit.author, date: commit.date, url: commit.url }} className="min-w-0 flex-1" />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <ResourcesSection data={data} />
    </>
  )
}

function WorkSection({ label, tasks, empty }: { label: string; tasks: DevelopmentOverview['work']['inProgress']; empty?: string }) {
  if (tasks.length === 0 && !empty) return null
  return (
    <div>
      <div className="flex items-center gap-2 border-t border-line bg-surface-2/40 px-4 py-1 text-[11px] font-semibold tracking-wider text-subtle uppercase first:border-t-0">
        {label} <Badge tone="outline">{tasks.length}</Badge>
      </div>
      {tasks.length === 0 ? <p className="px-4 py-2 text-xs text-subtle">{empty}</p> : tasks.map((task) => <TaskRow key={task.id} task={task} href={taskHref(task.project, task.id)} compact showProject />)}
    </div>
  )
}

function ResourcesSection({ data }: { data: DevelopmentOverview }) {
  const { t, i18n } = useTranslation('overview')
  const { t: th } = useTranslation('overview', { keyPrefix: 'host' })
  const metrics = useMetricsCurrent()
  const history = useMetricsHistory('30m')
  const environments = useEnvironments(true)
  const known = new Map((environments.data ?? []).map((environment) => [environment.name, environment]))
  return (
    <div className="mt-4 grid items-start gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        {metrics.data ? <HostResourcesCard data={metrics.data} history={history.data} locale={i18n.language} t={th} /> : null}
      </div>
      <Card className="mt-4">
        <CardHeader title={t('resources.top')} description={t('resources.topDescription')} />
        {data.resources.topProjects.length === 0 ? (
          <Empty title={t('resources.none')} />
        ) : (
          data.resources.topProjects.map((entry) => {
            const environment = known.get(entry.environment)
            return (
              <div key={entry.environment} className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2 text-sm last:border-b-0">
                <a className="font-medium underline-offset-2 hover:text-accent hover:underline" href={entry.slug ? `#/projects/${encodeURIComponent(entry.slug)}` : `#/environments/${encodeURIComponent(entry.environment)}`}>{entry.name}</a>
                <span className="font-mono text-[11px] text-subtle">{entry.environment}</span>
                <ResourceUsage cpu={entry.cpuUtilisation} memoryBytes={entry.memoryUsedBytes} className="text-[11px] text-subtle" />
                <span className="ml-auto">{environment && environment.runningCount > 0 ? <EnvironmentActions project={environment} /> : null}</span>
              </div>
            )
          })
        )}
      </Card>
    </div>
  )
}

/** The panel with no database, or a server that predates the dashboard: the gateway's own status, and nothing invented. */
function ReducedOverview({ reason }: { reason: number }) {
  const { t } = useTranslation('overview')
  const status = useStatus()
  if (status.isPending) return <Loading label={t('reading')} />
  if (status.error) return <ErrorBox error={status.error} />
  if (!status.data) return null
  const { gateway, problems } = status.data
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} actions={<Badge tone={gateway.up ? 'ok' : 'danger'}>{gateway.up ? t('gatewayRunning') : t('gatewayDown')}</Badge>} />
      <Card>
        <Empty title={reason === 503 ? t('reduced.needsDatabase') : t('reduced.unavailable')} hint={t('reduced.hint')} />
      </Card>
      <Card className="mt-4">
        <CardHeader title={t('attention.title')} actions={<Button size="sm" onClick={() => navigate('/gateway')}>{t('attention.diagnostics')}</Button>} />
        {problems.length === 0 ? (
          <CardBody>
            <div className="flex items-center gap-2 text-sm text-ok">
              <CheckCircle2 className="h-4 w-4" />
              {t('attention.none')}
            </div>
          </CardBody>
        ) : (
          <ul className="divide-y divide-line/70">
            {problems.map((problem) => (
              <li key={problem.id} className="flex gap-2.5 px-4 py-2.5">
                {problem.status === 'fail' ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />}
                <div className="min-w-0">
                  <DiagnosticText diagnostic={problem} part="title" className="text-sm font-medium text-ink" />
                  <DiagnosticText diagnostic={problem} part="detail" className="text-xs text-muted" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
