import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RotateCw } from 'lucide-react'
import { api } from '../lib/api.ts'
import type { ContainerSummary, Project } from '../../shared/types.ts'
import { Card, CardHeader } from '../components/ui/card.tsx'
import { Badge } from '../components/ui/badge.tsx'
import { Button } from '../components/ui/button.tsx'
import { Input } from '../components/ui/field.tsx'
import { Table, Td, Th, Tr } from '../components/ui/table.tsx'
import { Empty, ErrorBox, Loading, PageHeader } from '../components/shell-bits.tsx'
import { AddressLine } from '../components/copy.tsx'
import { ScopeBadge, StateBadge } from '../components/status.tsx'
import { ContainerActions } from '../components/container-actions.tsx'
import { ContainerDetails } from '../components/container-details.tsx'
import { shortImage, uptime } from '../lib/format.ts'
import { navigate } from '../lib/router.ts'
import { ServiceIcon } from '../components/service-icon.tsx'
import { GitCard } from '../components/git-card.tsx'

export function Projects({ selected }: { selected: string | null }) {
  const [search, setSearch] = useState('')
  const query = useQuery({ queryKey: ['projects'], queryFn: api.projects })

  const projects = useMemo(() => {
    const all = query.data ?? []
    const scoped = selected ? all.filter((project) => project.name === selected) : all
    if (search.trim() === '') return scoped
    const needle = search.toLowerCase()
    return scoped.filter((project) =>
      [project.name, ...project.services.map((service) => `${service.service} ${service.image}`)]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    )
  }, [query.data, search, selected])

  if (query.isPending) return <Loading />
  if (query.error) return <ErrorBox error={query.error} />

  return (
    <>
      <PageHeader
        title={selected ? selected : 'Projects'}
        description="Compose projects with at least one service on the gateway."
        actions={
          <>
            {selected ? (
              <Button size="sm" onClick={() => navigate('/projects')}>
                All projects
              </Button>
            ) : null}
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search project, service, image"
              className="w-64"
              aria-label="Search projects"
            />
          </>
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

  const urls = project.urls
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span>{project.name}</span>
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

      {urls.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line bg-surface-2/40 px-4 py-2">
          {urls.map((url) => (
            <span key={url.url} className="flex items-center gap-1.5">
              <ScopeBadge scope={url.scope} />
              <AddressLine value={url.url} href={url.url} />
            </span>
          ))}
        </div>
      ) : null}

      <Table>
        <thead>
          <tr>
            <Th>Service</Th>
            <Th>Image</Th>
            <Th>Status</Th>
            <Th>Ports</Th>
            <Th>Uptime</Th>
            <Th className="text-right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {project.services.map((service) => (
            <Tr key={service.id}>
              <Td>
                <button
                  className="flex items-center gap-1.5 text-left font-medium text-ink hover:text-accent"
                  onClick={() => setDetails(service)}
                >
                  <ServiceIcon tech={service.tech} />
                  <span>{service.service ?? service.name}</span>
                </button>
                <div className="text-[11px] text-subtle">
                  {service.kind}
                </div>
              </Td>
              <Td className="font-mono text-xs text-muted">{shortImage(service.image)}</Td>
              <Td>
                <StateBadge state={service.state} health={service.health} />
              </Td>
              <Td className="font-mono text-xs text-muted">
                {service.exposedPorts.length ? service.exposedPorts.join(', ') : '-'}
              </Td>
              <Td className="text-xs text-muted tabular-nums">{uptime(service.uptimeSeconds)}</Td>
              <Td>
                <ContainerActions container={service} onShowDetails={() => setDetails(service)} />
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>

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
