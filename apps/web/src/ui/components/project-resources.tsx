import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api.ts'
import { bytes } from '../lib/format.ts'
import { Card, CardBody, CardHeader } from './ui/card.tsx'
import { percentLabel } from './host-resources-lib.ts'
import type { Project } from '../../shared/types.ts'

export function ProjectResources({ project }: { project: Project }) {
  const { t, i18n } = useTranslation('gateway', { keyPrefix: 'project.resources' })
  const query = useQuery({
    queryKey: ['metrics-current'],
    queryFn: api.metricsCurrent,
    refetchInterval: 5_000,
  })
  const row = query.data?.projects.find((item) =>
    item.composeProject === project.name || item.id === project.name || item.name === project.group,
  )

  return (
    <Card>
      <CardHeader title={t('title')} description={t('description')} />
      <CardBody>
        {!row || row.containers.length === 0 ? (
          <p className="text-sm text-muted">{t('empty')}</p>
        ) : (
          <ul className="space-y-2">
            {row.containers.map((container) => (
              <li key={container.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-medium text-ink">{container.service ?? container.name}</span>
                <span className="text-xs text-muted">
                  {[
                    percentLabel(container.cpuUtilisation) ? `${t('cpu')} ${percentLabel(container.cpuUtilisation)}` : null,
                    container.memoryUsedBytes !== null ? `${t('memory')} ${bytes(container.memoryUsedBytes, i18n.language)}` : null,
                  ].filter(Boolean).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}
