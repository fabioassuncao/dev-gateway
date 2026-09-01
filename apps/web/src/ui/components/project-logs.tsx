import { useTranslation } from 'react-i18next'
import type { Project, ProjectLogSource } from '../../shared/types.ts'
import { api } from '../lib/api.ts'
import { Card } from './ui/card.tsx'
import { Empty } from './shell-bits.tsx'
import { LogViewer } from './logs.tsx'
import { navigate } from '../lib/router.ts'

export function ProjectLogs({ project, service }: { project: Project; service: string | null }) {
  const { t } = useTranslation('gateway', { keyPrefix: 'project' })

  const base = `/projects/${encodeURIComponent(project.name)}/logs`

  if (project.services.length === 0) {
    return (
      <Card>
        <Empty title={t('servicesEmpty')} hint={t('servicesEmptyHint')} />
      </Card>
    )
  }

  const selectable: ProjectLogSource[] = project.services.map((item) => ({
    containerId: item.id,
    service: item.service ?? item.name,
    name: item.name,
    state: item.state,
    lineCount: 0,
    truncated: false,
    error: null,
  }))

  return (
    <Card className="flex h-[70vh] min-h-0 flex-col overflow-hidden">
      <LogViewer
        className="min-h-0 flex-1"
        queryKey={['project-logs', project.name, service]}
        load={(tail) => api.projectLogs(project.name, { tail, service })}
        sources={selectable}
        selectedService={service}
        onSelectService={(next) => navigate(next ? `${base}?service=${encodeURIComponent(next)}` : base)}
        showOrigin={service === null}
      />
    </Card>
  )
}
