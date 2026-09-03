import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LayoutGrid, Table2, X } from 'lucide-react'
import { api, ApiError } from '../../lib/api/index.ts'
import { keys, useTasks } from '../../lib/queries/index.ts'
import type { TaskStatus, TaskSummary } from '../../../shared/task-types.ts'
import type { Project } from '../../../shared/types.ts'
import { Badge } from '../ui/badge.tsx'
import { Button } from '../ui/button.tsx'
import { Card } from '../ui/card.tsx'
import { Input, Select } from '../ui/field.tsx'
import { Segmented } from '../ui/segmented.tsx'
import { useToast } from '../ui/toast.tsx'
import { Empty, ErrorBox, Loading } from '../shell-bits.tsx'
import { useOptimisticMutation } from '../../lib/optimistic.ts'
import { navigate } from '../../lib/router.ts'
import {
  labelsOf,
  matchesFilters,
  tasksHref,
  typesOf,
  type TaskFilterValues,
  type TaskView,
} from '../../lib/tasks.ts'
import { useBoardColumns, useTaskStatuses } from '../../i18n/use-task-statuses.ts'
import { BoardEmpty, TaskBoard } from './task-board.tsx'
import { TaskTable } from './task-table.tsx'

/**
 * The Tasks tab of a project: one board or one table over the same rows, the
 * filters in the hash, and one dialog to create work.
 */
export function TasksTab({
  project,
  view,
  filters,
  readOnly = false,
}: {
  project: Project
  view: TaskView
  filters: TaskFilterValues
  readOnly?: boolean
}) {
  const { t } = useTranslation('tasks')
  const { statusOptions, priorityOptions } = useTaskStatuses()
  const boardColumns = useBoardColumns()
  const toast = useToast()
  const [failure, setFailure] = useState<unknown>(null)
  const slug = project.slug

  // The board wants every open task; the table is the place to look at what is
  // already done, so it asks for everything.
  const serverFilters = view === 'table' ? {} : { open: 'true' }
  const query = useTasks(slug, serverFilters)
  const queryKey = keys.tasks(slug, serverFilters)

  const move = useOptimisticMutation<unknown, { task: TaskSummary; status: TaskStatus; beforeId: string | null; afterId: string | null }, TaskSummary[]>({
    queryKey,
    mutationFn: ({ task, status, beforeId, afterId }) => api.moveTask(task.id, { status, beforeId, afterId }),
    update: (current, { task, status, beforeId, afterId }) => {
      if (!current) return current
      const without = current.filter((entry) => entry.id !== task.id)
      const destination = without.filter((entry) => entry.status === status).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
      const afterIndex = afterId ? destination.findIndex((entry) => entry.id === afterId) : -1
      const beforeIndex = beforeId ? destination.findIndex((entry) => entry.id === beforeId) : -1
      const index = afterIndex >= 0 ? afterIndex : beforeIndex >= 0 ? beforeIndex + 1 : destination.length
      destination.splice(index, 0, { ...task, status })
      const ranks = new Map(destination.map((entry, rank) => [entry.id, (rank + 1) * 1024]))
      return [...without, { ...task, status }].map((entry) => ranks.has(entry.id) ? { ...entry, status, position: ranks.get(entry.id)! } : entry)
    },
    // The card is already back where it started by the time this runs; the
    // toast is what tells the operator that, rather than the card twitching.
    onFailure: (error, { task }) => {
      setFailure(error)
      toast.push({
        tone: 'danger',
        title: t('moveFailed', { id: task.id }),
        description: error instanceof ApiError
          ? [error.message, error.hint].filter(Boolean).join(' · ')
          : t('moveFailedHint'),
      })
    },
  })

  const all = query.data ?? []
  const shown = useMemo(() => all.filter((task) => matchesFilters(task, filters)), [all, filters])
  const labels = useMemo(() => labelsOf(all), [all])
  const types = useMemo(() => typesOf(all), [all])
  const activeFilters = Object.values(filters).filter(Boolean).length

  const unavailable = query.error instanceof ApiError && query.error.status === 503
  const setFilter = (key: keyof TaskFilterValues, value: string) =>
    navigate(tasksHref(slug, view, { ...filters, [key]: value === '' ? undefined : value }))
  const setView = (next: TaskView) => navigate(tasksHref(slug, next, filters))

  const setStatus = (task: TaskSummary, status: TaskStatus) => {
    setFailure(null)
    move.mutate({ task, status, beforeId: null, afterId: null })
  }

  const controls = (
    <>
      <Input
        value={filters.q ?? ''}
        onChange={(event) => setFilter('q', event.target.value)}
        placeholder={t('filterPlaceholder')}
        className="h-8 w-52"
        aria-label={t('filterAria')}
      />
      <Select value={filters.status ?? ''} onChange={(event) => setFilter('status', event.target.value)} className="h-8 w-36" aria-label={t('statusFilter')}>
        <option value="">{t('anyStatus')}</option>
        {statusOptions.map((entry) => (
          <option key={entry.value} value={entry.value}>{entry.label}</option>
        ))}
      </Select>
      <Select value={filters.priority ?? ''} onChange={(event) => setFilter('priority', event.target.value)} className="h-8 w-32" aria-label={t('priorityFilter')}>
        <option value="">{t('anyPriority')}</option>
        {priorityOptions.filter((entry) => entry.value !== '').map((entry) => (
          <option key={entry.value} value={entry.value}>{entry.label}</option>
        ))}
      </Select>
      {types.length > 0 ? (
        <Select value={filters.type ?? ''} onChange={(event) => setFilter('type', event.target.value)} className="hidden h-8 w-32 lg:block" aria-label={t('typeFilter')}>
          <option value="">{t('anyType')}</option>
          {types.map((type) => <option key={type} value={type}>{type}</option>)}
        </Select>
      ) : null}
      {labels.length > 0 ? (
        <Select value={filters.label ?? ''} onChange={(event) => setFilter('label', event.target.value)} className="hidden h-8 w-32 lg:block" aria-label={t('labelFilter')}>
          <option value="">{t('anyLabel')}</option>
          {labels.map((label) => <option key={label} value={label}>{label}</option>)}
        </Select>
      ) : null}
      <Select value={filters.repository ?? ''} onChange={(event) => setFilter('repository', event.target.value)} className="hidden h-8 w-40 xl:block" aria-label={t('repositoryFilter')}>
        <option value="">{t('anyRepository')}</option>
        {project.repositories.map((repository) => (
          <option key={repository.id} value={repository.id}>{repository.name}</option>
        ))}
      </Select>
      {activeFilters > 0 ? (
        <Button size="sm" variant="ghost" onClick={() => navigate(tasksHref(slug, view))}>
          <X className="h-3.5 w-3.5" />
          {t('clearFilters')}
        </Button>
      ) : null}
    </>
  )

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented
          label={t('viewLabel')}
          value={view}
          onChange={setView}
          options={[
            { value: 'board', label: t('views.board'), icon: LayoutGrid },
            { value: 'table', label: t('views.table'), icon: Table2 },
          ]}
        />
        {view === 'board' ? controls : null}
        {readOnly ? <Badge tone="outline" className="ml-auto">{t('readOnly')}</Badge> : null}
      </div>

      {failure ? (
        <div className="mb-3">
          <ErrorBox error={failure} />
        </div>
      ) : null}

      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        unavailable ? (
          <Card><Empty title={t('needsDatabase')} hint={t('needsDatabaseHint')} /></Card>
        ) : (
          <ErrorBox error={query.error} />
        )
      ) : view === 'table' ? (
        <Card>
          <TaskTable
            slug={slug}
            tasks={shown}
            columns={boardColumns}
            readOnly={readOnly}
            onSetStatus={readOnly ? undefined : setStatus}
            toolbar={controls}
            empty={<BoardEmpty />}
          />
        </Card>
      ) : shown.length === 0 ? (
        <Card><BoardEmpty /></Card>
      ) : (
        <TaskBoard
          slug={slug}
          tasks={shown}
          columns={boardColumns}
          readOnly={readOnly}
          // A project with one repository does not need every card to repeat
          // its name; a project with several does.
          showRepository={project.repositories.length > 1}
          onMove={(task, status, beforeId, afterId) => {
            setFailure(null)
            move.mutate({ task, status, beforeId, afterId })
          }}
        />
      )}
    </>
  )
}
