import { useTranslation } from 'react-i18next'
import type { Environment } from '../../../shared/types.ts'
import { useEnvironmentGit } from '../../lib/queries/index.ts'
import { environmentHealth, healthTone } from '../../lib/health.ts'
import { serviceRowsFor } from '../../lib/services.ts'
import { useFormat } from '../../lib/use-format.ts'
import { Badge } from '../ui/badge.tsx'
import { Card, CardHeader } from '../ui/card.tsx'
import { EnvironmentActions } from '../environment-actions.tsx'
import { GitStatusLine } from './git-status-line.tsx'
import { EnvironmentOpenMenu } from './open-test-menu.tsx'
import { ServiceTable } from './service-table.tsx'

/**
 * One environment in a list: what it is, what code it runs, its services as
 * rows, and the actions that apply. The rows come from the container summary
 * the list already carries; the environment page measures them.
 */
export function EnvironmentCard({
  environment,
  owner = null,
  readOnly = false,
}: {
  environment: Environment
  /** The Project it was adopted by, when the list knows it. */
  owner?: { slug: string; name: string } | null
  readOnly?: boolean
}) {
  const { t } = useTranslation('environments')
  const { uptime } = useFormat()
  const git = useEnvironmentGit(environment.name)
  const health = environmentHealth(environment)
  const rows = serviceRowsFor(environment, null, readOnly).filter((row) => !row.hidden)
  const hidden = serviceRowsFor(environment, null, readOnly).filter((row) => row.hidden)

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <a
              href={`#/environments/${encodeURIComponent(environment.name)}`}
              className="underline-offset-2 hover:text-accent hover:underline"
              title={environment.overrides?.displayName ? t('derivedName', { name: environment.name }) : undefined}
            >
              {environment.overrides?.displayName ?? environment.name}
            </a>
            {environment.overrides?.pinned ? <Badge tone="accent">{t('pinned')}</Badge> : null}
            {environment.overrides?.archived ? <Badge tone="outline">{t('archived')}</Badge> : null}
            <Badge tone={healthTone(health)}>{t('running', { running: environment.runningCount, total: environment.serviceCount })}</Badge>
            {environment.unhealthyCount > 0 ? <Badge tone="danger">{t('unhealthy', { count: environment.unhealthyCount })}</Badge> : null}
            {environment.namespace ? <Badge tone="outline">{t('worktree', { name: environment.namespace })}</Badge> : null}
            {owner ? (
              <a className="text-xs text-muted underline-offset-2 hover:text-accent hover:underline" href={`#/projects/${encodeURIComponent(owner.slug)}`}>
                {t('header.project')}: {owner.name}
              </a>
            ) : environment.group ? (
              <Badge tone="outline">{t('partOf', { group: environment.group })}</Badge>
            ) : (
              <span className="text-xs text-subtle">{t('header.noProject')}</span>
            )}
          </span>
        }
        description={
          [
            environment.overrides?.displayName ? environment.name : null,
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
          </>
        }
      />
      {git.data ? <GitStatusLine git={git.data} variant="line" className="border-b border-line" refreshHint={false} /> : null}
      <ServiceTable services={rows} containers={environment.services} emptyTitle={t('servicesTable.empty')} />
      {hidden.length > 0 ? (
        <details className="border-t border-line px-4 py-2">
          <summary className="cursor-pointer text-xs text-subtle">
            {t(hidden.length === 1 ? 'collapsedService' : 'collapsedServices', { count: hidden.length })}
          </summary>
          <div className="-mx-4 mt-2">
            <ServiceTable services={hidden} containers={environment.services} />
          </div>
        </details>
      ) : null}
    </Card>
  )
}
