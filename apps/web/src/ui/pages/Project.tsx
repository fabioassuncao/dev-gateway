import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RotateCw } from 'lucide-react'
import { api, ApiError } from '../lib/api.ts'
import type { ContainerSummary, Project } from '../../shared/types.ts'
import { Card, CardBody, CardHeader } from '../components/ui/card.tsx'
import { Badge } from '../components/ui/badge.tsx'
import { Button } from '../components/ui/button.tsx'
import { Empty, ErrorBox, KeyValue, Loading, PageHeader, StatTile } from '../components/shell-bits.tsx'
import { Tabs, TabPanel, type TabDefinition } from '../components/ui/tabs.tsx'
import { ContainerDetails } from '../components/container-details.tsx'
import { ServiceEndpoints } from '../components/project-services.tsx'
import { ContainerActions } from '../components/container-actions.tsx'
import { ServiceIcon } from '../components/service-icon.tsx'
import { StateBadge } from '../components/status.tsx'
import { TraefikVerdictRow } from '../components/traefik-verdict.tsx'
import { SharePanel } from '../components/share-panel.tsx'
import { GitDetails } from '../components/git-details.tsx'
import { ProjectLogs } from '../components/project-logs.tsx'
import { Mono } from '../components/copy.tsx'
import { uptime, shortImage } from '../lib/format.ts'
import { useDocumentTitle } from '../lib/title.ts'
import { navigate } from '../lib/router.ts'

const TABS = ['overview', 'services', 'git', 'logs'] as const
export type ProjectTab = (typeof TABS)[number]

const LABELS: Record<ProjectTab, string> = {
  overview: 'Overview',
  services: 'Services',
  git: 'Git',
  logs: 'Logs',
}

/** An unknown tab is not an error: it falls back to the first one. */
export function resolveTab(requested: string | null): ProjectTab {
  return TABS.includes(requested as ProjectTab) ? (requested as ProjectTab) : 'overview'
}

export function ProjectPage({ project: name, tab: requested, service }: {
  project: string
  tab: string | null
  service: string | null
}) {
  const tab = resolveTab(requested)
  useDocumentTitle(tab === 'overview' ? null : LABELS[tab], name)

  const query = useQuery({
    queryKey: ['project', name],
    queryFn: () => api.project(name),
    retry: false,
  })

  if (query.isPending) return <Loading />

  // A project can stop between the list and this page. The endpoint says so
  // with a 404 and a sentence; render that as a state, never as a stack.
  if (query.error) {
    const missing = query.error instanceof ApiError && query.error.status === 404
    if (!missing) return <ErrorBox error={query.error} />
    return (
      <>
        <PageHeader title={name} />
        <Card>
          <Empty
            title={`No project '${name}' is running`}
            hint={
              <a className="text-accent hover:underline" href="#/projects">
                Back to all projects
              </a>
            }
          />
        </Card>
      </>
    )
  }

  const project = query.data!
  const tabs: TabDefinition[] = TABS.map((id) => ({
    id,
    label: LABELS[id],
    href: `/projects/${encodeURIComponent(name)}/${id}`,
  }))

  return (
    <>
      <ProjectHeader project={project} />
      <Tabs tabs={tabs} active={tab} label={`${name} sections`} />
      <TabPanel id={tab}>
        {tab === 'overview' ? <OverviewTab project={project} /> : null}
        {tab === 'services' ? <ServicesTab project={project} /> : null}
        {tab === 'git' ? <GitDetails project={project.name} /> : null}
        {tab === 'logs' ? <ProjectLogs project={project} service={service} /> : null}
      </TabPanel>
    </>
  )
}

function ProjectHeader({ project }: { project: Project }) {
  const queryClient = useQueryClient()

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
    <PageHeader
      title={project.name}
      description={
        [
          project.uptimeSeconds !== null ? `up ${uptime(project.uptimeSeconds)}` : null,
          project.workingDir,
        ]
          .filter(Boolean)
          .join(' · ') || undefined
      }
      actions={
        <>
          <Button size="sm" onClick={() => navigate('/projects')}>
            All projects
          </Button>
          <Button size="sm" disabled={restart.isPending} onClick={() => restart.mutate()}>
            <RotateCw className={restart.isPending ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
            Restart services
          </Button>
        </>
      }
    />
  )
}

function OverviewTab({ project }: { project: Project }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Services"
          value={`${project.runningCount}/${project.serviceCount}`}
          tone={project.runningCount === project.serviceCount ? 'ok' : 'warn'}
          hint="running"
        />
        <StatTile
          label="Unhealthy"
          value={project.unhealthyCount}
          tone={project.unhealthyCount > 0 ? 'danger' : undefined}
        />
        <StatTile label="Routed URLs" value={project.urls.length} />
        <StatTile
          label="Uptime"
          value={project.uptimeSeconds === null ? '—' : uptime(project.uptimeSeconds)}
        />
      </div>

      <Card>
        <CardHeader title="Environment" description="What this Compose project is, and where it lives." />
        <CardBody>
          <dl className="divide-y divide-line/60">
            <KeyValue label="Host directory">
              {project.workingDir ? <Mono value={project.workingDir} /> : <span className="text-subtle">unknown</span>}
            </KeyValue>
            <KeyValue label="Integrated">
              {project.integrated ? (
                <Badge tone="ok">on the gateway</Badge>
              ) : (
                <Badge tone="outline">not routed by the gateway</Badge>
              )}
            </KeyValue>
            {project.namespace ? <KeyValue label="Worktree">{project.namespace}</KeyValue> : null}
            {project.group ? <KeyValue label="Logical project">{project.group}</KeyValue> : null}
            {project.gitRoot ? (
              <KeyValue label="Git root">
                <Mono value={project.gitRoot} />
              </KeyValue>
            ) : null}
            {project.repo ? (
              <KeyValue label="Repository">
                {project.repoUrl ? (
                  <a
                    className="underline-offset-2 hover:text-accent hover:underline"
                    href={project.repoUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {project.repo}
                  </a>
                ) : (
                  project.repo
                )}
              </KeyValue>
            ) : null}
            <KeyValue label="Networks">
              <span className="font-mono text-xs text-muted">
                {project.networks.length > 0 ? project.networks.join(', ') : 'none'}
              </span>
            </KeyValue>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Endpoints"
          description="Every address this project answers on, grouped by service."
        />
        {project.services.length === 0 ? (
          <Empty title="This project has no services" />
        ) : (
          <div>
            {project.services.map((service) => (
              <div
                key={service.id}
                className="grid gap-2 border-b border-line px-4 py-2 last:border-b-0 lg:grid-cols-[minmax(10rem,0.6fr)_1fr] lg:items-start"
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <ServiceIcon tech={service.tech} />
                  <span className="truncate text-sm font-medium">{service.service ?? service.name}</span>
                  <StateBadge state={service.state} health={service.health} />
                </div>
                <ServiceEndpoints service={service} />
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Repository"
          description="Collected on the host; see the Git tab for the whole snapshot."
          actions={
            <a
              className="text-xs text-accent hover:underline"
              href={`#/projects/${encodeURIComponent(project.name)}/git`}
            >
              Open Git tab
            </a>
          }
        />
        <GitSummary project={project.name} />
      </Card>
    </div>
  )
}

function GitSummary({ project }: { project: string }) {
  const query = useQuery({
    queryKey: ['project-git', project],
    queryFn: () => api.projectGit(project),
    staleTime: 30_000,
  })

  const data = query.data
  if (!data) return <Empty title="Reading collected Git metadata" />
  if (!data.collected || !data.git) {
    return (
      <Empty
        title="No Git metadata collected for this project"
        hint={<code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono">{data.refreshCommand}</code>}
      />
    )
  }

  const git = data.git
  const changed = git.staged + git.unstaged + git.untracked + git.unmerged
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs">
      <Badge tone="outline">{git.detached ? 'detached HEAD' : git.branch}</Badge>
      <span className="font-mono text-subtle">{git.head.shortSha}</span>
      <Badge tone={changed > 0 ? 'warn' : 'ok'}>{changed > 0 ? `${changed} uncommitted` : 'clean'}</Badge>
      {git.ahead > 0 ? <Badge tone="outline">{git.ahead} ahead</Badge> : null}
      {git.behind > 0 ? <Badge tone="outline">{git.behind} behind</Badge> : null}
      {data.forge?.authenticated ? (
        <Badge tone="outline">
          {data.forge.pulls.length} open pull {data.forge.pulls.length === 1 ? 'request' : 'requests'}
        </Badge>
      ) : null}
    </div>
  )
}

function ServicesTab({ project }: { project: Project }) {
  const [details, setDetails] = useState<ContainerSummary | null>(null)

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

  return (
    <>
      <div className="space-y-4">
        {project.services.map((service) => (
          <ServiceDetailCard key={service.id} service={service} onShowDetails={() => setDetails(service)} />
        ))}
      </div>
      {details ? (
        <ContainerDetails
          container={details}
          open={details !== null}
          onOpenChange={(open) => !open && setDetails(null)}
        />
      ) : null}
    </>
  )
}

function ServiceDetailCard({
  service,
  onShowDetails,
}: {
  service: ContainerSummary
  onShowDetails: () => void
}) {
  const name = service.service ?? service.name

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <ServiceIcon tech={service.tech} />
            <span>{name}</span>
            <StateBadge state={service.state} health={service.health} />
            {service.restartCount > 0 ? (
              <Badge tone={service.restartCount > 3 ? 'danger' : 'warn'}>
                {service.restartCount} restarts
              </Badge>
            ) : null}
            {service.state !== 'running' && service.exitCode !== null ? (
              <Badge tone="danger">exit {service.exitCode}</Badge>
            ) : null}
          </span>
        }
        description={`${shortImage(service.image)} · ${service.name}`}
        actions={<ContainerActions container={service} onShowDetails={onShowDetails} />}
      />
      <CardBody>
        <dl className="divide-y divide-line/60">
          <KeyValue label="Endpoints">
            <ServiceEndpoints service={service} />
          </KeyValue>
          <KeyValue label="Container ports">
            <span className="font-mono text-xs text-muted">
              {service.exposedPorts.length > 0 ? service.exposedPorts.join(', ') : 'none exposed'}
            </span>
          </KeyValue>
          {service.ports.length > 0 ? (
            <KeyValue label="Published ports">
              <div className="space-y-0.5 font-mono text-xs text-muted">
                {service.ports.map((port) => (
                  <div key={`${port.ip}:${port.hostPort}`}>
                    {port.ip}:{port.hostPort} → {port.containerPort}/{port.protocol}
                  </div>
                ))}
              </div>
            </KeyValue>
          ) : null}
          <KeyValue label="Networks">
            <span className="font-mono text-xs text-muted">
              {service.networks.length > 0 ? service.networks.join(', ') : 'none'}
            </span>
          </KeyValue>
          {service.mounts.length > 0 ? (
            <KeyValue label="Mounts">
              <div className="space-y-0.5 font-mono text-xs text-muted">
                {service.mounts.map((mount) => (
                  <div key={mount.destination}>
                    {mount.type}: {mount.name ?? mount.source} → {mount.destination}
                    {mount.rw ? '' : ' (ro)'}
                  </div>
                ))}
              </div>
            </KeyValue>
          ) : null}
          {service.urls.length > 0 ? (
            <KeyValue label="Traefik">
              <TraefikVerdictRow container={service} enabled />
            </KeyValue>
          ) : null}
          {service.urls.length > 0 ? (
            <KeyValue label="Exposure">
              <SharePanel container={service} />
            </KeyValue>
          ) : null}
        </dl>
      </CardBody>
    </Card>
  )
}
