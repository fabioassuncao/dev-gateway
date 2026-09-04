import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { ApiError } from '../lib/api/index.ts'
import { useProjects } from '../lib/queries/index.ts'
import type { ProjectSummary } from 'portta-contracts'
import { Button } from '../components/ui/button.tsx'
import { Dialog } from '../components/ui/dialog.tsx'
import { Field, Select } from '../components/ui/field.tsx'
import { Empty, ErrorBox, PageHeader } from '../components/shell-bits.tsx'
import { TasksView } from '../components/tasks/tasks-view.tsx'
import { useKickCreate } from '../lib/kick-create.ts'
import { rememberTasksReturn, resolveTaskView, restoreTasksScroll, taskFiltersFrom, tasksHref } from '../lib/tasks.ts'
import { useDocumentTitle } from '../lib/title.ts'

/**
 * Every task on the panel: the same board and table the project tab uses,
 * without a project implied until one is picked to create or to filter.
 */
export function Tasks({ query = '', readOnly = false }: { query?: string; readOnly?: boolean }) {
  const { t } = useTranslation('tasks')
  useDocumentTitle(t('title'))
  const catalog = useProjects()
  const [picking, setPicking] = useState(false)
  const params = new URLSearchParams(query.replace(/^\?/, ''))
  const view = resolveTaskView(params.get('view'))
  const filters = taskFiltersFrom(params)
  const listHref = tasksHref({ global: true }, view, filters)
  const projects = (catalog.data ?? []).filter((project) => !project.archived)
  const unavailable = catalog.error instanceof ApiError && catalog.error.status === 503

  useEffect(() => {
    restoreTasksScroll()
  }, [])

  return (
    <>
      <PageHeader
        title={t('title')}
        actions={
          <Button size="sm" variant="primary" disabled={readOnly || projects.length === 0} onClick={() => setPicking(true)}>
            <Plus />
            {t('newTask')}
          </Button>
        }
      />
      {catalog.error && !unavailable ? (
        <ErrorBox error={catalog.error} />
      ) : (
        <TasksView
          scope={{ kind: 'global', projects: catalog.data ?? [] }}
          view={view}
          filters={filters}
          readOnly={readOnly}
        />
      )}
      {picking ? (
        <PickProjectDialog
          open
          onOpenChange={setPicking}
          projects={projects}
          listHref={listHref}
          preset={filters.project}
        />
      ) : null}
    </>
  )
}

function PickProjectDialog({
  open,
  onOpenChange,
  projects,
  listHref,
  preset,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projects: ProjectSummary[]
  listHref: string
  preset?: string
}) {
  const { t } = useTranslation('tasks')
  const [slug, setSlug] = useState(() => (preset && projects.some((project) => project.slug === preset) ? preset : projects[0]?.slug ?? ''))
  const kick = useKickCreate(slug, { from: 'tasks' })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('pickProject')}
      description={t('pickProjectHint')}
      size="sm"
      footer={
        <Button
          variant="primary"
          size="sm"
          busy={kick.isPending}
          disabled={slug === ''}
          onClick={() => {
            rememberTasksReturn(listHref)
            kick.mutate()
          }}
        >
          {t('newTask')}
        </Button>
      }
    >
      {projects.length === 0 ? (
        <Empty title={t('noProjects')} />
      ) : (
        <Field label={t('projectFilter')} required>
          {(id) => (
            <Select id={id} value={slug} onChange={(event) => setSlug(event.target.value)} aria-label={t('projectFilter')}>
              {projects.map((project) => (
                <option key={project.slug} value={project.slug}>{project.name}</option>
              ))}
            </Select>
          )}
        </Field>
      )}
    </Dialog>
  )
}
