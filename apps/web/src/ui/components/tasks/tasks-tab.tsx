import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LayoutGrid, List, Plus } from 'lucide-react'
import { api, ApiError } from '../../lib/api/index.ts'
import { keys, useTasks } from '../../lib/queries/index.ts'
import type { TaskStatus, TaskSummary } from '../../../shared/task-types.ts'
import type { Project } from '../../../shared/types.ts'
import { Badge } from '../ui/badge.tsx'
import { Button } from '../ui/button.tsx'
import { Card } from '../ui/card.tsx'
import { Input, Select } from '../ui/field.tsx'
import { Empty, ErrorBox, Loading } from '../shell-bits.tsx'
import { useOptimisticMutation } from '../../lib/optimistic.ts'
import { navigate } from '../../lib/router.ts'
import { matchesFilters, tasksHref, type TaskFilterValues, type TaskView } from '../../lib/tasks.ts'
import { useTaskStatuses } from '../../i18n/use-task-statuses.ts'
import { BoardEmpty, TaskBoard } from './task-board.tsx'
import { TaskList } from './task-list.tsx'
import { useKickCreate } from '../../lib/kick-create.ts'

/**
 * The Tasks tab of a project: one board or one list over the same rows, the
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
  const { statusOptions } = useTaskStatuses()
  const [failure, setFailure] = useState<unknown>(null)
  const slug = project.slug
  const kickCreate = useKickCreate(slug)

  // The server takes every filter but the board wants every open task, so
  // the request asks for the whole open set and the narrowing happens here.
  const serverFilters = view === 'list' ? {} : { open: 'true' }
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
    onFailure: (error) => setFailure(error),
  })

  const shown = useMemo(() => (query.data ?? []).filter((task) => matchesFilters(task, filters)), [query.data, filters])
  const unavailable = query.error instanceof ApiError && query.error.status === 503
  const setFilter = (key: keyof TaskFilterValues, value: string) =>
    navigate(tasksHref(slug, view, { ...filters, [key]: value === '' ? undefined : value }))
  const setView = (next: TaskView) => navigate(tasksHref(slug, next, filters))

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div role="group" aria-label={t('viewLabel')} className="flex rounded-md border border-line">
          <button type="button" aria-pressed={view === 'board'} onClick={() => setView('board')} className={`flex items-center gap-1 px-2 py-1 text-xs ${view === 'board' ? 'bg-accent/12 text-accent' : 'text-muted hover:text-ink'}`}>
            <LayoutGrid className="h-3.5 w-3.5" /> {t('views.board')}
          </button>
          <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')} className={`flex items-center gap-1 px-2 py-1 text-xs ${view === 'list' ? 'bg-accent/12 text-accent' : 'text-muted hover:text-ink'}`}>
            <List className="h-3.5 w-3.5" /> {t('views.list')}
          </button>
        </div>
        <Input value={filters.q ?? ''} onChange={(event) => setFilter('q', event.target.value)} placeholder={t('filterPlaceholder')} className="h-8 w-56" aria-label={t('filterAria')} />
        <Select value={filters.status ?? ''} onChange={(event) => setFilter('status', event.target.value)} className="h-8 w-40" aria-label={t('statusFilter')}>
          <option value="">{t('anyStatus')}</option>
          {statusOptions.map((entry) => (
            <option key={entry.value} value={entry.value}>{entry.label}</option>
          ))}
        </Select>
        <Select value={filters.repository ?? ''} onChange={(event) => setFilter('repository', event.target.value)} className="h-8 w-44" aria-label={t('repositoryFilter')}>
          <option value="">{t('anyRepository')}</option>
          {project.repositories.map((repository) => (
            <option key={repository.id} value={repository.id}>{repository.name}</option>
          ))}
        </Select>
        <Input value={filters.assignee ?? ''} onChange={(event) => setFilter('assignee', event.target.value)} placeholder={t('assigneeFilter')} className="h-8 w-36" aria-label={t('assigneeFilter')} />
        {readOnly ? <Badge tone="outline">{t('readOnly')}</Badge> : null}
        <Button size="sm" variant="primary" className="ml-auto" disabled={readOnly || kickCreate.isPending} onClick={() => kickCreate.mutate()}>
          <Plus className="h-3.5 w-3.5" />
          {t('newTask')}
        </Button>
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
      ) : view === 'list' ? (
        <Card>
          <TaskList slug={slug} tasks={shown} />
        </Card>
      ) : shown.length === 0 ? (
        <Card><BoardEmpty /></Card>
      ) : (
        <TaskBoard
          slug={slug}
          tasks={shown}
          readOnly={readOnly}
          onMove={(task, status, beforeId, afterId) => {
            setFailure(null)
            move.mutate({ task, status, beforeId, afterId })
          }}
        />
      )}

      {kickCreate.error ? (
        <div className="mt-3">
          <ErrorBox error={kickCreate.error} />
        </div>
      ) : null}
    </>
  )
}
