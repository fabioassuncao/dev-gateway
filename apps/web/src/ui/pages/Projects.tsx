import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { LayoutGrid, List, Plus } from 'lucide-react'
import { api, ApiError } from '../lib/api/index.ts'
import { keys, useDevelopmentOverview, useEnvironments, useProjects } from '../lib/queries/index.ts'
import { Button } from '../components/ui/button.tsx'
import { Card } from '../components/ui/card.tsx'
import { Dialog } from '../components/ui/dialog.tsx'
import { Input } from '../components/ui/field.tsx'
import { ProjectCard, ProjectRow, pulseFor } from '../components/entities/project-card.tsx'
import { Empty, ErrorBox, Loading, PageHeader } from '../components/shell-bits.tsx'
import { slug as slugify } from '../../shared/slug.ts'
import { useDocumentTitle } from '../lib/title.ts'

type Density = 'cards' | 'rows'

export function Projects() {
  const { t } = useTranslation('projects')
  useDocumentTitle(t('title'))
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [density, setDensity] = useState<Density>(() => {
    try {
      return localStorage.getItem('portta-projects-density') === 'rows' ? 'rows' : 'cards'
    } catch {
      return 'cards'
    }
  })
  const catalog = useProjects()
  const overview = useDevelopmentOverview()
  const runtimes = useEnvironments(true)

  const catalogUnavailable = catalog.error instanceof ApiError && catalog.error.status === 503
  const items = useMemo(() => {
    const all = [...(catalog.data ?? [])].sort((left, right) => Number(left.archived) - Number(right.archived))
    const needle = search.trim().toLowerCase()
    const shown = needle === '' ? all : all.filter((project) => [project.slug, project.name, project.description ?? ''].join(' ').toLowerCase().includes(needle))
    return shown.map((summary) => pulseFor(summary, overview.data?.projects))
  }, [catalog.data, overview.data, search])

  const choose = (next: Density) => {
    setDensity(next)
    try {
      localStorage.setItem('portta-projects-density', next)
    } catch {
      /* private browsing */
    }
  }

  if (catalog.error && !catalogUnavailable) return <ErrorBox error={catalog.error} />

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('catalogDescription')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('searchPlaceholder')} className="w-64" aria-label={t('searchAria')} />
            <div role="group" aria-label={t('densityLabel')} className="flex rounded-md border border-line">
              <button type="button" aria-pressed={density === 'cards'} onClick={() => choose('cards')} className={`px-2 py-1 ${density === 'cards' ? 'bg-accent/12 text-accent' : 'text-muted hover:text-ink'}`} title={t('density.cards')}>
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
              <button type="button" aria-pressed={density === 'rows'} onClick={() => choose('rows')} className={`px-2 py-1 ${density === 'rows' ? 'bg-accent/12 text-accent' : 'text-muted hover:text-ink'}`} title={t('density.rows')}>
                <List className="h-3.5 w-3.5" />
              </button>
            </div>
            <Button variant="primary" disabled={catalogUnavailable} onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" />
              {t('newProject')}
            </Button>
          </div>
        }
      />

      <section className="mb-6 space-y-3">
        {catalog.isPending ? (
          <Loading />
        ) : catalogUnavailable ? (
          <Card>
            <Empty title={t('needsDatabase')} hint={t('needsDatabaseHint')} />
          </Card>
        ) : items.length === 0 ? (
          <Card>
            <Empty title={t('catalogEmpty')} hint={t('catalogEmptyHint')} />
          </Card>
        ) : density === 'rows' ? (
          <Card>
            {items.map((item) => (
              <ProjectRow key={item.kind === 'pulse' ? item.pulse.slug : item.summary.slug} item={item} />
            ))}
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <ProjectCard key={item.kind === 'pulse' ? item.pulse.slug : item.summary.slug} item={item} />
            ))}
          </div>
        )}
      </section>

      <p className="text-sm">
        <a className="text-accent underline-offset-2 hover:underline" href="#/environments">
          {t('environmentsLink', { count: runtimes.data?.length ?? 0 })}
        </a>
      </p>

      {creating ? <CreateProjectDialog open onOpenChange={setCreating} /> : null}
    </>
  )
}

function CreateProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
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
      void queryClient.invalidateQueries({ queryKey: keys.projects() })
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
        <Button variant="primary" size="sm" disabled={name.trim() === '' || create.isPending} onClick={() => create.mutate()}>
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
          <Input value={slug} onChange={(event) => setSlug(event.target.value)} placeholder={name.trim() === '' ? 'meu-produto' : slugify(name)} aria-label={t('create.slug')} />
          <span className="mt-0.5 block text-[11px] text-subtle">{t('create.slugHint')}</span>
        </label>
        <label className="block">
          <span className="text-xs text-subtle">{t('create.descriptionLabel')}</span>
          <Input value={description} onChange={(event) => setDescription(event.target.value)} aria-label={t('create.descriptionLabel')} />
        </label>
      </div>
    </Dialog>
  )
}
