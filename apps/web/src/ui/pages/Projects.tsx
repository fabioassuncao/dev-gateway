import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { RotateCw } from 'lucide-react'
import { api } from '../lib/api.ts'
import type { ContainerSummary, Project } from '../../shared/types.ts'
import { Card, CardHeader } from '../components/ui/card.tsx'
import { Badge } from '../components/ui/badge.tsx'
import { Button } from '../components/ui/button.tsx'
import { Input } from '../components/ui/field.tsx'
import { Empty, ErrorBox, Loading, PageHeader } from '../components/shell-bits.tsx'
import { ContainerDetails } from '../components/container-details.tsx'
import { GitCard } from '../components/git-card.tsx'
import { useDocumentTitle } from '../lib/title.ts'
import { ServiceRow } from '../components/project-services.tsx'

import { useFormat } from '../lib/use-format.ts'

export function Projects() {
  const { t } = useTranslation('projects')
  useDocumentTitle(t('title'))
  const [search, setSearch] = useState('')
  const query = useQuery({ queryKey: ['projects'], queryFn: api.projects })

  const projects = useMemo(() => {
    // Pinned first, archived last, then the derived order. Both are overrides
    // stored by the gateway; neither changes anything about the project.
    const all = [...(query.data ?? [])].sort((left, right) => {
      const rank = (project: Project) =>
        (project.overrides?.pinned ? -1 : 0) + (project.overrides?.archived ? 2 : 0)
      return rank(left) - rank(right)
    })
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
        title={t('title')}
        description={t('description')}
        actions={
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('searchPlaceholder')}
            className="w-64"
            aria-label={t('searchAria')}
          />
        }
      />

      {projects.length === 0 ? (
        <Card>
          <Empty title={t('empty')} hint={t('emptyHint')} />
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
  const { t } = useTranslation('projects')
  const { uptime: formatUptime } = useFormat()
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

  // Collapsed, never removed: a hidden service is still one keystroke away.
  const hidden = new Set(project.overrides?.hiddenServices ?? [])
  const visible = project.services.filter((service) => !hidden.has(service.service ?? service.name))
  const collapsed = project.services.filter((service) => hidden.has(service.service ?? service.name))

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <a
              href={`#/projects/${encodeURIComponent(project.name)}`}
              className="underline-offset-2 hover:text-accent hover:underline"
              title={project.overrides?.displayName ? t('derivedName', { name: project.name }) : undefined}
            >
              {project.overrides?.displayName ?? project.name}
            </a>
            {project.overrides?.pinned ? <Badge tone="accent">{t('pinned')}</Badge> : null}
            {project.overrides?.archived ? <Badge tone="outline">{t('archived')}</Badge> : null}
            <Badge tone={project.runningCount === project.serviceCount ? 'ok' : 'warn'}>
              {t('running', { running: project.runningCount, total: project.serviceCount })}
            </Badge>
            {project.unhealthyCount > 0 ? (
              <Badge tone="danger">{t('unhealthy', { count: project.unhealthyCount })}</Badge>
            ) : null}
            {project.namespace ? <Badge tone="outline">{t('worktree', { name: project.namespace })}</Badge> : null}
            {project.group ? <Badge tone="outline">{t('partOf', { group: project.group })}</Badge> : null}
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
            project.overrides?.displayName ? project.name : null,
            project.overrides?.description ?? null,
            project.uptimeSeconds !== null ? t('up', { time: formatUptime(project.uptimeSeconds) }) : null,
            project.workingDir,
          ]
            .filter(Boolean)
            .join(' · ') || undefined
        }
        actions={
          <Button size="sm" disabled={restart.isPending} onClick={() => restart.mutate()}>
            <RotateCw className={restart.isPending ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
            {t('restartServices')}
          </Button>
        }
      />

      <GitCard project={project.name} />

      <div>
        {visible.map((service) => (
          <ServiceRow key={service.id} service={service} onShowDetails={() => setDetails(service)} />
        ))}
      </div>

      {collapsed.length > 0 ? (
        <details className="border-t border-line px-4 py-2">
          <summary className="cursor-pointer text-xs text-subtle">
            {t(collapsed.length === 1 ? 'collapsedService' : 'collapsedServices', { count: collapsed.length })}
          </summary>
          <div className="-mx-4 mt-2">
            {collapsed.map((service) => (
              <ServiceRow key={service.id} service={service} onShowDetails={() => setDetails(service)} />
            ))}
          </div>
        </details>
      ) : null}

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
