import type { Project, ProjectLogSource } from '../../shared/types.ts'
import { api } from '../lib/api.ts'
import { Card } from './ui/card.tsx'
import { Empty } from './shell-bits.tsx'
import { LogViewer } from './logs.tsx'
import { navigate } from '../lib/router.ts'

/**
 * Every service of a project, read together.
 *
 * The merge, the clamping and the per-source failures come from the server,
 * which already owns log normalisation; this is the same `LogViewer` the
 * container dialog uses, with a selector and an origin gutter.
 */
export function ProjectLogs({ project, service }: { project: Project; service: string | null }) {
  const base = `/projects/${encodeURIComponent(project.name)}/logs`

  if (project.services.length === 0) {
    return (
      <Card>
        <Empty
          title="This project has no services"
          hint="A project joins by adding the gateway overlay: see docs/adopting-projects.md."
        />
      </Card>
    )
  }

  // The selector lists every service of the project rather than only the ones
  // this read covered, so narrowing to one is always reversible from here.
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
