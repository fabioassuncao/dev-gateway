import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api.ts'
import { bytes } from '../lib/format.ts'
import { navigate } from '../lib/router.ts'
import { Button } from './ui/button.tsx'
import { Card, CardBody, CardHeader } from './ui/card.tsx'
import { EnvironmentActions } from './environment-actions.tsx'
import { percentLabel } from './host-resources-lib.ts'
import type { Environment, ProjectResourceMetrics } from '../../shared/types.ts'

export function EnvironmentConsumption({ projects }: { projects: ProjectResourceMetrics[] }) {
  const { t, i18n } = useTranslation('overview', { keyPrefix: 'consumption' })
  const list = useQuery({ queryKey: ['environments'], queryFn: () => api.environments() })
  const known = new Map((list.data ?? []).map((project) => [project.name, project]))
  const rows = [...projects]
    .filter((project) => project.id !== '_standalone' || project.containerCount > 0)
    .sort((left, right) => (right.memoryUsedBytes ?? 0) - (left.memoryUsedBytes ?? 0))

  if (rows.length === 0) return null

  return (
    <Card className="mt-4">
      <CardHeader title={t('title')} description={t('description')} />
      <CardBody className="space-y-3">
        {rows.map((row) => {
          const project = known.get(row.composeProject) ?? known.get(row.id)
          return (
            <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3 last:border-0 last:pb-0">
              <div className="min-w-0">
                <button
                  type="button"
                  className="text-left text-sm font-medium text-ink hover:underline"
                  onClick={() => navigate(`/environments/${encodeURIComponent(row.composeProject)}`)}
                >
                  {project?.overrides?.displayName ?? row.name}
                </button>
                <div className="text-xs text-muted">
                  {[
                    percentLabel(row.cpuUtilisation) ? `${t('cpu')} ${percentLabel(row.cpuUtilisation)}` : null,
                    row.memoryUsedBytes !== null ? `${t('memory')} ${bytes(row.memoryUsedBytes, i18n.language)}` : null,
                    t('containers', { count: row.containerCount }),
                  ].filter(Boolean).join(' · ')}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button size="sm" onClick={() => navigate(`/environments/${encodeURIComponent(row.composeProject)}`)}>
                  {t('open')}
                </Button>
                {project ? <CompactStop project={project} /> : null}
              </div>
            </div>
          )
        })}
      </CardBody>
    </Card>
  )
}

function CompactStop({ project }: { project: Environment }) {
  if (project.runningCount === 0) return null
  return <EnvironmentActions project={project} />
}
