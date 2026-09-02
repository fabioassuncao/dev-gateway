import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { api, ApiError } from '../lib/api.ts'
import type { ContainerSummary, Environment, ProjectSummary } from '../../shared/types.ts'
import { Badge } from '../components/ui/badge.tsx'
import { Button } from '../components/ui/button.tsx'
import { Card, CardHeader } from '../components/ui/card.tsx'
import { Dialog } from '../components/ui/dialog.tsx'
import { Input } from '../components/ui/field.tsx'
import { Empty, ErrorBox, Loading, PageHeader } from '../components/shell-bits.tsx'
import { ProjectActions } from '../components/project-actions.tsx'
import { ContainerDetails } from '../components/container-details.tsx'
import { GitCard } from '../components/git-card.tsx'
import { ServiceRow } from '../components/project-services.tsx'
import { slug as slugify } from '../../shared/slug.ts'
import { useDocumentTitle } from '../lib/title.ts'
import { useFormat } from '../lib/use-format.ts'

export function Projects() {
  const { t } = useTranslation('projects')
  useDocumentTitle(t('title'))
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const catalog = useQuery({ queryKey: ['projects'], queryFn: api.projects, retry: false })
  const runtimes = useQuery({ queryKey: ['environments'], queryFn: () => api.environments(true) })

  const catalogUnavailable = catalog.error instanceof ApiError && catalog.error.status === 503
  const projects = useMemo(() => {
    const all = [...(catalog.data ?? [])].sort((left, right) => Number(left.archived) - Number(right.archived))
    if (search.trim() === '') return all
    const needle = search.toLowerCase()
    return all.filter((project) =>
      [project.slug, project.name, project.description ?? ''].join(' ').toLowerCase().includes(needle),
    )
  }, [catalog.data, search])

  const environments = useMemo(() => {
    const all = [...(runtimes.data ?? [])].sort((left, right) => {
      const rank = (environment: Environment) =>
        (environment.overrides?.pinned ? -1 : 0) + (environment.overrides?.archived ? 2 : 0)
      return rank(left) - rank(right)
    })
    if (search.trim() === '') return all
    const needle = search.toLowerCase()
    return all.filter((environment) =>
      [environment.name, ...environment.services.map((service) => `${service.service} ${service.image}`)]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    )
  }, [runtimes.data, search])

  if (runtimes.isPending && catalog.isPending) return <Loading />
  if (runtimes.error) return <ErrorBox error={runtimes.error} />
  if (catalog.error && !catalogUnavailable) return <ErrorBox error={catalog.error} />

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('catalogDescription')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('searchPlaceholder')}
              className="w-64"
              aria-label={t('searchAria')}
            />
            <Button variant="primary" disabled={catalogUnavailable} onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" />
              {t('newProject')}
            </Button>
          </div>
        }
      />

      <section className="mb-6 space-y-3">
        <h2 className="text-sm font-semibold text-ink">{t('catalogTitle')}</h2>
        {catalog.isPending ? (
          <Loading />
        ) : catalogUnavailable ? (
          <Card>
            <Empty title={t('needsDatabase')} hint={t('needsDatabaseHint')} />
          </Card>
        ) : projects.length === 0 ? (
          <Card>
            <Empty title={t('catalogEmpty')} hint={t('catalogEmptyHint')} />
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <CatalogCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink">{t('environmentsTitle')}</h2>
        {environments.length === 0 ? (
          <Card>
            <Empty title={t('empty')} hint={t('emptyHint')} />
          </Card>
        ) : (
          <div className="space-y-4">
            {environments.map((environment) => (
              <EnvironmentCard key={environment.name} project={environment} />
            ))}
          </div>
        )}
      </section>

      {creating ? <CreateProjectDialog open onOpenChange={setCreating} /> : null}
    </>
  )
}

function CatalogCard({ project }: { project: ProjectSummary }) {
  const { t } = useTranslation('projects')
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <a
              className="underline-offset-2 hover:text-accent hover:underline"
              href={`#/projects/${encodeURIComponent(project.slug)}`}
            >
              {project.name}
            </a>
            {project.archived ? <Badge tone="outline">{t('archived')}</Badge> : null}
          </span>
        }
        description={project.description ?? undefined}
      />
      <div className="flex flex-wrap items-center gap-1.5 px-4 py-3">
        <Badge tone="outline">
          {t(project.repositoryCount === 1 ? 'repository' : 'repositories', {
            count: project.repositoryCount,
          })}
        </Badge>
        <Badge tone={project.runningEnvironmentCount > 0 ? 'ok' : 'neutral'}>
          {t('running', {
            running: project.runningEnvironmentCount,
            total: project.environmentCount,
          })}
        </Badge>
      </div>
    </Card>
  )
}

function EnvironmentCard({ project }: { project: Environment }) {
  const { t } = useTranslation('projects')
  const { uptime: formatUptime } = useFormat()
  const [details, setDetails] = useState<ContainerSummary | null>(null)

  const hidden = new Set(project.overrides?.hiddenServices ?? [])
  const visible = project.services.filter((service) => !hidden.has(service.service ?? service.name))
  const collapsed = project.services.filter((service) => hidden.has(service.service ?? service.name))

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <a
              href={`#/environments/${encodeURIComponent(project.name)}`}
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
        actions={<ProjectActions project={project} />}
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

function CreateProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('projects')
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')

  const create = useMutation({
    mutationFn: () =>
      api.createProject({
        name: name.trim(),
        slug: slug.trim() === '' ? slugify(name) : slug.trim(),
        description: description.trim() === '' ? null : description.trim(),
      }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
      onOpenChange(false)
      window.location.hash = `/projects/${encodeURIComponent(created.slug)}`
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('create.title')}
      description={t('create.description')}
      footer={
        <Button
          variant="primary"
          size="sm"
          disabled={name.trim() === '' || create.isPending}
          onClick={() => create.mutate()}
        >
          {t('create.create')}
        </Button>
      }
    >
      {create.error ? <ErrorBox error={create.error} /> : null}
      <div className="space-y-3">
        <label className="block">
          <span className="text-xs text-subtle">{t('create.name')}</span>
          <Input value={name} onChange={(event) => setName(event.target.value)} aria-label={t('create.name')} />
        </label>
        <label className="block">
          <span className="text-xs text-subtle">{t('create.slug')}</span>
          <Input
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            placeholder={name.trim() === '' ? 'meu-produto' : slugify(name)}
            aria-label={t('create.slug')}
          />
          <span className="mt-0.5 block text-[11px] text-subtle">{t('create.slugHint')}</span>
        </label>
        <label className="block">
          <span className="text-xs text-subtle">{t('create.descriptionLabel')}</span>
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            aria-label={t('create.descriptionLabel')}
          />
        </label>
      </div>
    </Dialog>
  )
}
