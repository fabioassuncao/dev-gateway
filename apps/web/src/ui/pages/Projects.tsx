import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { LayoutGrid, Plus, Table2 } from 'lucide-react'
import { api, ApiError } from '../lib/api/index.ts'
import { keys, useDevelopmentOverview, useEnvironments, useProjects } from '../lib/queries/index.ts'
import { Button } from '../components/ui/button.tsx'
import { Card } from '../components/ui/card.tsx'
import { Dialog } from '../components/ui/dialog.tsx'
import { Input, Select } from '../components/ui/field.tsx'
import { Segmented } from '../components/ui/segmented.tsx'
import { ProjectCard } from '../components/entities/project-card.tsx'
import { ProjectTable } from '../components/entities/project-table.tsx'
import { Empty, ErrorBox, PageHeader, SkeletonRows } from '../components/shell-bits.tsx'
import {
  DEFAULT_PROJECT_FILTERS,
  defaultProjectOrder,
  matchesProjectFilters,
  resolveProjectView,
  toListItems,
  type ProjectFilters,
  type ProjectState,
  type ProjectView,
} from '../lib/projects.ts'
import { slug as slugify } from '../../shared/slug.ts'
import { useDocumentTitle } from '../lib/title.ts'

const VIEW_STORAGE = 'portta-projects-view'

const STATES: ProjectState[] = ['running', 'partial', 'unhealthy', 'idle', 'archived']

export function Projects() {
  const { t } = useTranslation('projects')
  useDocumentTitle(t('title'))
  const [filters, setFilters] = useState<ProjectFilters>(DEFAULT_PROJECT_FILTERS)
  const [creating, setCreating] = useState(false)
  const [view, setView] = useState<ProjectView>(() => {
    try {
      return resolveProjectView(localStorage.getItem(VIEW_STORAGE))
    } catch {
      return 'cards'
    }
  })
  const catalog = useProjects()
  const overview = useDevelopmentOverview()
  const runtimes = useEnvironments(true)

  const catalogUnavailable = catalog.error instanceof ApiError && catalog.error.status === 503

  const items = useMemo(
    () => toListItems(catalog.data ?? [], overview.data?.projects).sort(defaultProjectOrder),
    [catalog.data, overview.data],
  )
  const shown = useMemo(
    () => items.filter((item) => matchesProjectFilters(item, filters)),
    [items, filters],
  )

  const chooseView = (next: ProjectView) => {
    setView(next)
    try {
      localStorage.setItem(VIEW_STORAGE, next)
    } catch {
      /* private browsing */
    }
  }

  const set = <Key extends keyof ProjectFilters>(key: Key, value: ProjectFilters[Key]) =>
    setFilters((current) => ({ ...current, [key]: value }))

  if (catalog.error && !catalogUnavailable) return <ErrorBox error={catalog.error} />

  // The same controls above the cards and inside the table's toolbar, so the
  // two views are the same page in two shapes rather than two pages.
  const controls = (
    <>
      <Input
        value={filters.search}
        onChange={(event) => set('search', event.target.value)}
        placeholder={t('searchPlaceholder')}
        className="h-8 w-56"
        aria-label={t('searchAria')}
      />
      <Select
        value={filters.state}
        onChange={(event) => set('state', event.target.value as ProjectFilters['state'])}
        className="h-8 w-36"
        aria-label={t('filters.state')}
      >
        <option value="all">{t('filters.anyState')}</option>
        {STATES.map((state) => (
          <option key={state} value={state}>{t(`state.${state}` as 'state.running')}</option>
        ))}
      </Select>
      <label className="flex items-center gap-1.5 text-xs text-muted">
        <input
          type="checkbox"
          className="h-3.5 w-3.5 accent-[var(--portta-accent)]"
          checked={filters.includeArchived}
          onChange={(event) => set('includeArchived', event.target.checked)}
        />
        {t('filters.showArchived')}
      </label>
    </>
  )

  const emptyState = items.length === 0
    ? <Empty title={t('catalogEmpty')} hint={t('catalogEmptyHint')} action={<Button variant="primary" size="sm" onClick={() => setCreating(true)}>{t('newProject')}</Button>} />
    : <Empty title={t('noMatch')} hint={t('noMatchHint')} action={<Button size="sm" onClick={() => setFilters(DEFAULT_PROJECT_FILTERS)}>{t('filters.anyState')}</Button>} />

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('catalogDescription')}
        actions={
          <>
            <Segmented
              label={t('viewLabel')}
              value={view}
              onChange={chooseView}
              options={[
                { value: 'cards', label: t('views.cards'), icon: LayoutGrid },
                { value: 'table', label: t('views.table'), icon: Table2 },
              ]}
            />
            <Button variant="primary" disabled={catalogUnavailable} onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" />
              {t('newProject')}
            </Button>
          </>
        }
      />

      <section className="mb-6">
        {catalog.isPending ? (
          // The controls and the shape of the list stay put, so nothing jumps
          // when the catalog lands.
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">{controls}</div>
            <Card><SkeletonRows rows={4} /></Card>
          </>
        ) : catalogUnavailable ? (
          <Card>
            <Empty title={t('needsDatabase')} hint={t('needsDatabaseHint')} />
          </Card>
        ) : view === 'table' ? (
          <Card>
            <ProjectTable items={shown} toolbar={controls} empty={emptyState} />
          </Card>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">{controls}</div>
            {shown.length === 0 ? (
              <Card>{emptyState}</Card>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {shown.map((item) => (
                  <ProjectCard key={item.slug} item={item} />
                ))}
              </div>
            )}
          </>
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
        <Button variant="primary" size="sm" busy={create.isPending} disabled={name.trim() === ''} onClick={() => create.mutate()}>
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
