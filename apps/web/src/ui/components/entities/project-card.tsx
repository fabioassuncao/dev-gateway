import { useTranslation } from 'react-i18next'
import type { ProjectSummary } from '../../../shared/types.ts'
import type { ProjectPulse } from '../../../shared/overview-types.ts'
import { Badge } from '../ui/badge.tsx'
import { Card, CardHeader } from '../ui/card.tsx'
import { useFormat } from '../../lib/use-format.ts'
import { ResourceUsage } from './resource-usage.tsx'
import { cn } from '../../lib/utils.ts'

/**
 * What a project list shows about each product. A pulse (from the dashboard)
 * says what is happening; a summary (from the catalog) says what it owns.
 * Both render through the same rows, so the page reads the same either way.
 */
export type ProjectLike =
  | { kind: 'pulse'; pulse: ProjectPulse }
  | { kind: 'summary'; summary: ProjectSummary }

export function pulseFor(summary: ProjectSummary, pulses: readonly ProjectPulse[] | undefined): ProjectLike {
  const pulse = pulses?.find((entry) => entry.slug === summary.slug)
  return pulse ? { kind: 'pulse', pulse } : { kind: 'summary', summary }
}

function healthTone(health: ProjectPulse['health']): 'ok' | 'warn' | 'danger' | 'neutral' {
  return health === 'ok' ? 'ok' : health === 'partial' ? 'warn' : health === 'unhealthy' ? 'danger' : 'neutral'
}

function ProjectFacts({ item }: { item: ProjectLike }) {
  const { t } = useTranslation('projects')
  const { relativeTime } = useFormat()
  if (item.kind === 'summary') {
    const project = item.summary
    return (
      <>
        <Badge tone="outline">{t(project.repositoryCount === 1 ? 'repository' : 'repositories', { count: project.repositoryCount })}</Badge>
        <Badge tone={project.runningEnvironmentCount > 0 ? 'ok' : 'neutral'}>
          {t('running', { running: project.runningEnvironmentCount, total: project.environmentCount })}
        </Badge>
      </>
    )
  }
  const pulse = item.pulse
  return (
    <>
      <Badge tone="outline">{t(pulse.repositoryCount === 1 ? 'repository' : 'repositories', { count: pulse.repositoryCount })}</Badge>
      <Badge tone={pulse.inProgressTasks > 0 ? 'info' : 'outline'}>
        {t('pulse.tasks', { open: pulse.openTasks, inProgress: pulse.inProgressTasks })}
      </Badge>
      {pulse.blockedTasks > 0 ? <Badge tone="danger">{t('pulse.blocked', { count: pulse.blockedTasks })}</Badge> : null}
      {pulse.activeSessions > 0 ? <Badge tone="accent">{t('pulse.sessions', { count: pulse.activeSessions })}</Badge> : null}
      <Badge tone={healthTone(pulse.health)}>
        {t('running', { running: pulse.runningEnvironments, total: pulse.environmentCount })}
        {pulse.unhealthyServices > 0 ? ` · ${t('pulse.unhealthy', { count: pulse.unhealthyServices })}` : ''}
      </Badge>
      {pulse.lastCommit ? (
        <span className="font-mono text-[11px] text-subtle" title={pulse.lastCommit.subject}>
          {pulse.lastCommit.repository} {pulse.lastCommit.shortSha} · {relativeTime(pulse.lastCommit.date)}
        </span>
      ) : null}
      {pulse.resources ? <ResourceUsage cpu={pulse.resources.cpuUtilisation} memoryBytes={pulse.resources.memoryUsedBytes} className="text-[11px] text-subtle" /> : null}
    </>
  )
}

function nameOf(item: ProjectLike) {
  return item.kind === 'pulse' ? item.pulse : item.summary
}

export function ProjectCard({ item }: { item: ProjectLike }) {
  const { t } = useTranslation('projects')
  const project = nameOf(item)
  const description = item.kind === 'summary' ? item.summary.description : item.pulse.lastActivity
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <a className="underline-offset-2 hover:text-accent hover:underline" href={`#/projects/${encodeURIComponent(project.slug)}`}>
              {project.name}
            </a>
            {project.archived ? <Badge tone="outline">{t('archived')}</Badge> : null}
          </span>
        }
        description={description ?? undefined}
      />
      <div className="flex flex-wrap items-center gap-1.5 px-4 py-3">
        <ProjectFacts item={item} />
      </div>
    </Card>
  )
}

export function ProjectRow({ item, className }: { item: ProjectLike; className?: string }) {
  const { t } = useTranslation('projects')
  const project = nameOf(item)
  return (
    <div role="group" aria-label={project.name} className={cn('flex min-w-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2 text-sm last:border-b-0', className)}>
      <a className="font-medium text-ink underline-offset-2 hover:text-accent hover:underline" href={`#/projects/${encodeURIComponent(project.slug)}`}>
        {project.name}
      </a>
      {project.archived ? <Badge tone="outline">{t('archived')}</Badge> : null}
      <ProjectFacts item={item} />
    </div>
  )
}
