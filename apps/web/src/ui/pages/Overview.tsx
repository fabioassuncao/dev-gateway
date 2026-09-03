import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Boxes, CheckCircle2, CircleDot, GitCommitHorizontal, ShieldCheck, XCircle } from 'lucide-react'
import { ApiError } from '../lib/api/index.ts'
import { useDevelopmentOverview, useEnvironments, useMetricsCurrent, useMetricsHistory, useStatus } from '../lib/queries/index.ts'
import type { DevelopmentOverview } from '../../shared/overview-types.ts'
import { navigate } from '../lib/router.ts'
import { Card, CardBody, CardHeader, CardSection } from '../components/ui/card.tsx'
import { Badge } from '../components/ui/badge.tsx'
import { Button } from '../components/ui/button.tsx'
import { Empty, ErrorBox, Loading, PageHeader } from '../components/shell-bits.tsx'
import { DiagnosticText } from '../components/diagnostic-text.tsx'
import { HostSummary, HostSummarySkeleton } from '../components/host-summary.tsx'
import { EnvironmentActions } from '../components/environment-actions.tsx'
import { CommitRow } from '../components/entities/commit-row.tsx'
import { ProjectRow } from '../components/entities/project-card.tsx'
import { fromPulse } from '../lib/projects.ts'
import { ResourceUsage } from '../components/entities/resource-usage.tsx'
import { SessionRow } from '../components/entities/session-row.tsx'
import { TaskRow } from '../components/entities/task-row.tsx'
import { taskHref } from '../lib/tasks.ts'
import { useDocumentTitle } from '../lib/title.ts'
import { cn } from '../lib/utils.ts'

/**
 * What is happening: the host it happens on, the work, who is on it, what
 * needs attention, what changed. Infrastructure has its own pages; this one
 * answers the question a person asks when they open the panel.
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

/**
 * One panel of the cockpit.
 *
 * The page is a list of these rather than nested JSX, so the composition is
 * data: reordering the dashboard, or hiding a panel a given host has nothing
 * to say about, is an edit to one array. Drag-and-drop is not here because
 * nobody has asked to move these five things; the arrangement being data is
 * what makes adding it later a change to this file alone.
 */
interface Widget {
  id: string
  span: 1 | 2 | 3
  content: ReactNode
}

const SPAN: Record<1 | 2 | 3, string> = {
  1: '',
  2: 'lg:col-span-2',
  3: 'lg:col-span-3',
}

/**
 * The gateway's state belongs beside the host's, in the band at the top. When
 * there are no host metrics that band does not render, so the badge falls back
 * to the page header rather than disappearing with it.
 */
function GatewayBadge({ up }: { up: boolean }) {
  const { t } = useTranslation('overview')
  return <Badge tone={up ? 'ok' : 'danger'} dot>{up ? t('gatewayRunning') : t('gatewayDown')}</Badge>
}

function Dashboard({ data }: { data: DevelopmentOverview }) {
  const { t } = useTranslation('overview')
  const metrics = useMetricsCurrent()
  const history = useMetricsHistory('30m')

  const widgets: Widget[] = [
    { id: 'work', span: 2, content: <WorkPanel data={data} /> },
    { id: 'sessions', span: 1, content: <SessionsPanel data={data} /> },
    { id: 'attention', span: 3, content: <AttentionPanel data={data} /> },
    { id: 'projects', span: 2, content: <ProjectsPanel data={data} /> },
    { id: 'resources', span: 1, content: <EnvironmentUsagePanel data={data} /> },
    { id: 'code', span: 3, content: <CodePanel data={data} /> },
  ]

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={metrics.data ? undefined : <GatewayBadge up={data.gateway.up} />}
      />

      {metrics.data ? (
        <HostSummary
          data={metrics.data}
          history={history.data}
          pressure={data.resources.host?.pressure}
          gateway={{ up: data.gateway.up, label: data.gateway.up ? t('gatewayRunning') : t('gatewayDown') }}
        />
      ) : metrics.isPending ? <HostSummarySkeleton /> : null}

      <div className="grid items-start gap-4 lg:grid-cols-3">
        {widgets.map((widget) => (
          <div key={widget.id} className={cn('min-w-0', SPAN[widget.span])}>
            {widget.content}
          </div>
        ))}
      </div>
    </>
  )
}

function WorkPanel({ data }: { data: DevelopmentOverview }) {
  const { t } = useTranslation('overview')
  const { t: tk } = useTranslation('tasks')
  const work = data.work
  return (
    <Card>
      <CardHeader
        title={t('work.title')}
        meta={<Badge tone={work.counts.open > 0 ? 'accent' : 'neutral'}>{work.counts.open} {t('work.open')}</Badge>}
        description={t('work.description', { open: work.counts.open, inProgress: work.counts.inProgress, review: work.counts.review, blocked: work.counts.blocked })}
      />
      {work.counts.open === 0 ? (
        <Empty icon={CheckCircle2} tone="ok" title={t('work.empty')} hint={t('work.emptyHint')} />
      ) : (
        <>
          <WorkSection label={tk('status.inProgress')} tasks={work.inProgress} empty={t('work.nothingInProgress')} />
          <WorkSection label={tk('status.review')} tasks={work.review} />
          <WorkSection label={tk('status.blocked')} tasks={work.blocked} />
        </>
      )}
    </Card>
  )
}

function WorkSection({ label, tasks, empty }: { label: string; tasks: DevelopmentOverview['work']['inProgress']; empty?: string }) {
  if (tasks.length === 0 && !empty) return null
  return (
    <CardSection label={label} count={tasks.length}>
      {tasks.length === 0
        ? <p className="px-4 py-2 text-xs text-subtle">{empty}</p>
        : tasks.map((task) => <TaskRow key={task.id} task={task} href={taskHref(task.project, task.id)} compact showProject showAge />)}
    </CardSection>
  )
}

function SessionsPanel({ data }: { data: DevelopmentOverview }) {
  const { t } = useTranslation('overview')
  const { t: ts } = useTranslation('sessions')
  const agents = data.sessions.filter((session) => session.actorKind === 'agent').length
  return (
    <Card>
      <CardHeader
        title={t('sessions.title')}
        meta={data.sessions.length > 0 ? <Badge tone="agent" dot>{ts('active', { count: data.sessions.length })}</Badge> : null}
        description={agents > 0 ? t('sessions.description') : undefined}
      />
      {data.sessions.length === 0 ? (
        <Empty compact icon={CircleDot} title={t('sessions.empty')} />
      ) : (
        data.sessions.map((session) => <SessionRow key={session.id} session={session} showProject />)
      )}
    </Card>
  )
}

function AttentionPanel({ data }: { data: DevelopmentOverview }) {
  const { t } = useTranslation('overview')
  const failures = data.attention.filter((item) => item.severity === 'fail').length
  return (
    <Card>
      <CardHeader
        title={t('attention.title')}
        meta={data.attention.length > 0
          ? <Badge tone={failures > 0 ? 'danger' : 'warn'} dot>{t('attention.count', { count: data.attention.length })}</Badge>
          : null}
        description={data.attention.length > 0 ? t('attention.description') : undefined}
        actions={<Button size="sm" variant="ghost" onClick={() => navigate('/gateway')}>{t('attention.diagnostics')}</Button>}
      />
      {data.attention.length === 0 ? (
        <Empty compact icon={ShieldCheck} tone="ok" title={t('attention.none')} />
      ) : (
        <ul className="divide-y divide-line/70">
          {data.attention.map((item, index) => (
            <li key={`${item.kind}-${index}`} className="flex items-center gap-2.5 px-4 py-2 text-sm">
              {item.severity === 'fail'
                ? <XCircle className="h-4 w-4 shrink-0 text-danger" aria-hidden />
                : <AlertTriangle className="h-4 w-4 shrink-0 text-warn" aria-hidden />}
              <a className="min-w-0 flex-1 truncate text-ink underline-offset-2 hover:text-accent hover:underline" href={item.href}>
                {item.summary}
              </a>
              {item.project ? <Badge tone="outline">{item.project}</Badge> : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function ProjectsPanel({ data }: { data: DevelopmentOverview }) {
  const { t } = useTranslation('overview')
  const shown = data.projects.filter((pulse) => !pulse.archived).slice(0, 8)
  return (
    <Card>
      <CardHeader
        title={t('projects.title')}
        icon={<Boxes className="h-4 w-4" />}
        actions={<a className="text-xs text-accent hover:underline" href="#/projects">{t('projects.all')}</a>}
      />
      {shown.length === 0 ? (
        <Empty compact title={t('projects.empty')} hint={t('projects.emptyHint')} />
      ) : (
        shown.map((pulse) => <ProjectRow key={pulse.slug} item={fromPulse(pulse)} />)
      )}
    </Card>
  )
}

function EnvironmentUsagePanel({ data }: { data: DevelopmentOverview }) {
  const { t } = useTranslation('overview')
  const environments = useEnvironments(true)
  const known = new Map((environments.data ?? []).map((environment) => [environment.name, environment]))
  return (
    <Card>
      <CardHeader
        title={t('resources.top')}
        meta={<Badge tone="outline">{t('resources.environments')} {data.runtime.environmentsRunning}/{data.runtime.environmentsTotal}</Badge>}
        description={t('resources.topDescription')}
      />
      {data.resources.topProjects.length === 0 ? (
        <Empty compact title={t('resources.none')} />
      ) : (
        data.resources.topProjects.map((entry) => {
          const environment = known.get(entry.environment)
          return (
            <div key={entry.environment} className="group flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-4 py-2 text-sm last:border-b-0">
              <a
                className="min-w-0 truncate font-medium underline-offset-2 hover:text-accent hover:underline"
                href={entry.slug ? `#/projects/${encodeURIComponent(entry.slug)}` : `#/environments/${encodeURIComponent(entry.environment)}`}
              >
                {entry.name}
              </a>
              <ResourceUsage cpu={entry.cpuUtilisation} memoryBytes={entry.memoryUsedBytes} className="text-[11px]" />
              {environment && environment.runningCount > 0 ? (
                <span className="row-actions ml-auto"><EnvironmentActions project={environment} /></span>
              ) : null}
            </div>
          )
        })
      )}
    </Card>
  )
}

function CodePanel({ data }: { data: DevelopmentOverview }) {
  const { t } = useTranslation('overview')
  const dirty = data.code.dirtyRepositories
  const commits = data.code.recentCommits
  return (
    <Card>
      <CardHeader
        title={t('code.title')}
        icon={<GitCommitHorizontal className="h-4 w-4" />}
        description={t('code.description')}
      />
      {dirty.length > 0 ? (
        <CardSection label={t('code.dirty')} count={dirty.length}>
          <ul className="divide-y divide-line/70">
            {dirty.map((repository) => (
              <li key={repository.id} className="flex flex-wrap items-center gap-2 px-4 py-1.5 text-sm">
                <a
                  className="font-medium underline-offset-2 hover:text-accent hover:underline"
                  href={`#/projects/${encodeURIComponent(repository.project)}/repositories/${encodeURIComponent(repository.id)}`}
                >
                  {repository.name}
                </a>
                <span className="text-[11px] text-subtle">{repository.project}</span>
                <span className="font-mono text-[11px] text-muted">{repository.branch ?? '—'}</span>
                {repository.changed > 0 ? <Badge tone="warn">{t('code.uncommitted', { count: repository.changed })}</Badge> : null}
                {repository.ahead > 0 ? <Badge tone="outline">↑{repository.ahead}</Badge> : null}
                {repository.behind > 0 ? <Badge tone="outline">↓{repository.behind}</Badge> : null}
              </li>
            ))}
          </ul>
        </CardSection>
      ) : null}
      {commits.length === 0 ? (
        <Empty compact title={t('code.empty')} hint={t('code.emptyHint')} />
      ) : (
        <CardSection label={t('code.recent')} count={commits.length}>
          <ul className="divide-y divide-line/70">
            {commits.map((commit) => (
              <li key={`${commit.repository.id}-${commit.sha}`} className="flex items-center gap-2 px-4 py-0.5 text-sm">
                <a
                  className="w-32 shrink-0 truncate text-xs text-muted hover:text-accent"
                  href={`#/projects/${encodeURIComponent(commit.project)}/repositories/${encodeURIComponent(commit.repository.id)}/commits`}
                  title={`${commit.project} · ${commit.repository.name}`}
                >
                  {commit.repository.name}
                </a>
                <CommitRow
                  commit={{ sha: commit.sha, shortSha: commit.shortSha, subject: commit.subject, author: commit.author, date: commit.date, url: commit.url }}
                  className="min-w-0 flex-1"
                />
              </li>
            ))}
          </ul>
        </CardSection>
      )}
    </Card>
  )
}

/** The panel with no database, or a server that predates the dashboard: the gateway's own status, and nothing invented. */
function ReducedOverview({ reason }: { reason: number }) {
  const { t } = useTranslation('overview')
  const status = useStatus()
  const metrics = useMetricsCurrent()
  const history = useMetricsHistory('30m')
  if (status.isPending) return <Loading label={t('reading')} />
  if (status.error) return <ErrorBox error={status.error} />
  if (!status.data) return null
  const { gateway, problems } = status.data
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={metrics.data ? undefined : <GatewayBadge up={gateway.up} />}
      />
      {metrics.data ? (
        <HostSummary
          data={metrics.data}
          history={history.data}
          gateway={{ up: gateway.up, label: gateway.up ? t('gatewayRunning') : t('gatewayDown') }}
        />
      ) : null}
      <Card>
        <Empty title={reason === 503 ? t('reduced.needsDatabase') : t('reduced.unavailable')} hint={t('reduced.hint')} />
      </Card>
      <Card className="mt-4">
        <CardHeader title={t('attention.title')} actions={<Button size="sm" onClick={() => navigate('/gateway')}>{t('attention.diagnostics')}</Button>} />
        {problems.length === 0 ? (
          <CardBody>
            <div className="flex items-center gap-2 text-sm text-ok">
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              {t('attention.none')}
            </div>
          </CardBody>
        ) : (
          <ul className="divide-y divide-line/70">
            {problems.map((problem) => (
              <li key={problem.id} className="flex gap-2.5 px-4 py-2.5">
                {problem.status === 'fail'
                  ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
                  : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />}
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
