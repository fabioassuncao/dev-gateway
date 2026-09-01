import type { Project } from '../../shared/types.ts'
import { Card } from './ui/card.tsx'
import { Empty } from './shell-bits.tsx'

/**
 * The Logs tab's route and shell. Reading every service of a project in one
 * interleaved stream is its own change; this keeps the tab addressable until
 * then rather than shipping a fourth tab that 404s.
 */
export function ProjectLogs({ project, service }: { project: Project; service: string | null }) {
  return (
    <Card>
      <Empty
        title={
          service
            ? `Aggregated logs for ${service} are not available yet`
            : 'Aggregated project logs are not available yet'
        }
        hint={`Open a service from the Services tab to read its output, or run docker compose -p ${project.name} logs on the host.`}
      />
    </Card>
  )
}
