import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RotateCw } from 'lucide-react'
import { api } from '../lib/api.ts'
import type { ContainerSummary, Project } from '../../shared/types.ts'
import { Card, CardHeader } from '../components/ui/card.tsx'
import { Badge } from '../components/ui/badge.tsx'
import { Button } from '../components/ui/button.tsx'
import { Input } from '../components/ui/field.tsx'
import { Empty, ErrorBox, Loading, PageHeader } from '../components/shell-bits.tsx'
import { ContainerDetails } from '../components/container-details.tsx'
import { uptime } from '../lib/format.ts'
import { GitCard } from '../components/git-card.tsx'
import { useDocumentTitle } from '../lib/title.ts'
import { ServiceRow } from '../components/project-services.tsx'

export function Projects() {
  useDocumentTitle('Projects')
  const [search, setSearch] = useState('')
  const query = useQuery({ queryKey: ['projects'], queryFn: api.projects })

  const projects = useMemo(() => {
    const all = query.data ?? []
    if (search.trim() === '') return all
    const needle = search.toLowerCase()
    return all.filter((project) =>
      [project.name, ...project.services.map((service) => `${service.service} ${service.image}`)]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    )
  }, [query.data, search])

  if (query.isPending) return <Loading />
  if (query.error) return <ErrorBox error={query.error} />

  return (
    <>
      <PageHeader
        title="Projects"
        description="Compose projects with at least one service on the gateway."
        actions={
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search project, service, image"
            className="w-64"
            aria-label="Search projects"
          />
        }
      />

      {projects.length === 0 ? (
        <Card>
          <Empty
            title="No integrated project is running"
            hint="A project joins by adding the gateway overlay: see docs/adopting-projects.md."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {projects.map((project) => (
            <ProjectCard key={project.name} project={project} />
          ))}
        </div>
      )}
    </>
  )
}

function ProjectCard({ project }: { project: Project }) {
  const queryClient = useQueryClient()
  const [details, setDetails] = useState<ContainerSummary | null>(null)

  const restart = useMutation({
    mutationFn: async () => {
      for (const service of project.services) {
        if (service.state !== 'running') continue
        await api.containerAction(service.id, 'restart')
      }
    },
    onSuccess: () => void queryClient.invalidateQueries(),
  })

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <a
              href={`#/projects/${encodeURIComponent(project.name)}`}
              className="underline-offset-2 hover:text-accent hover:underline"
            >
              {project.name}
            </a>
            <Badge tone={project.runningCount === project.serviceCount ? 'ok' : 'warn'}>
              {project.runningCount}/{project.serviceCount} running
            </Badge>
            {project.unhealthyCount > 0 ? (
              <Badge tone="danger">{project.unhealthyCount} unhealthy</Badge>
            ) : null}
            {project.namespace ? <Badge tone="outline">worktree: {project.namespace}</Badge> : null}
            {project.group ? <Badge tone="outline">part of {project.group}</Badge> : null}
            {project.repoUrl ? (
              <a
                className="text-xs text-muted underline-offset-2 hover:text-accent hover:underline"
                href={project.repoUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                {project.repo}
              </a>
            ) : null}
          </span>
        }
        description={
          [
            project.uptimeSeconds !== null ? `up ${uptime(project.uptimeSeconds)}` : null,
            project.workingDir,
          ]
            .filter(Boolean)
            .join(' · ') || undefined
        }
        actions={
          <Button size="sm" disabled={restart.isPending} onClick={() => restart.mutate()}>
            <RotateCw className={restart.isPending ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
            Restart services
          </Button>
        }
      />

      <GitCard project={project.name} />

      <div>
        {project.services.map((service) => (
          <ServiceRow key={service.id} service={service} onShowDetails={() => setDetails(service)} />
        ))}
      </div>

      {details ? (
        <ContainerDetails
          container={details}
          open={details !== null}
          onOpenChange={(open) => !open && setDetails(null)}
        />
      ) : null}
    </Card>
  )
}
