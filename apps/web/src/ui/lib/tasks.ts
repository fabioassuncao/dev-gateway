// The rules of the task views: nesting, addressing, and filters in the hash.

import type { TaskSummary } from '../../shared/task-types.ts'

export const TASK_VIEWS = ['board', 'list'] as const
export type TaskView = (typeof TASK_VIEWS)[number]

export const TASK_FILTERS = ['status', 'assignee', 'repository', 'q'] as const
export type TaskFilterKey = (typeof TASK_FILTERS)[number]
export type TaskFilterValues = Partial<Record<TaskFilterKey, string>>

export function resolveTaskView(requested: string | null | undefined): TaskView {
  return requested === 'list' ? 'list' : 'board'
}

export function taskHref(slug: string, id: string): string {
  return `#/projects/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(id)}`
}

/** The tab's own address: a filtered board is a link somebody can paste. */
export function tasksHref(slug: string, view: TaskView, filters: TaskFilterValues = {}): string {
  const query = new URLSearchParams()
  if (view !== 'board') query.set('view', view)
  for (const key of TASK_FILTERS) {
    const value = filters[key]
    if (value) query.set(key, value)
  }
  const suffix = query.toString()
  return `/projects/${encodeURIComponent(slug)}/tasks${suffix ? `?${suffix}` : ''}`
}

export function taskFiltersFrom(params: URLSearchParams | Record<string, string>): TaskFilterValues {
  const get = (key: string) => (params instanceof URLSearchParams ? params.get(key) : params[key]) ?? ''
  const filters: TaskFilterValues = {}
  for (const key of TASK_FILTERS) {
    const value = get(key)
    if (value) filters[key] = value
  }
  return filters
}

/** Where the old board hash goes: same project, same filters, the tasks tab. */
export function boardToTasksHref(slug: string, legacyView: string | null, query: string): string {
  const params = new URLSearchParams(query.replace(/^\?/, ''))
  const filters = taskFiltersFrom(params)
  return tasksHref(slug, legacyView === 'backlog' ? 'list' : 'board', filters)
}

export interface NestedTask {
  task: TaskSummary
  depth: number
}

/** Parents before children, children indented, never deeper than four. */
export function nestTasks(tasks: readonly TaskSummary[]): NestedTask[] {
  const byParent = new Map<string | null, TaskSummary[]>()
  const ids = new Set(tasks.map((task) => task.id))
  for (const task of tasks) {
    const parent = task.parentId !== null && ids.has(task.parentId) ? task.parentId : null
    const list = byParent.get(parent) ?? []
    list.push(task)
    byParent.set(parent, list)
  }
  const rows: NestedTask[] = []
  const seen = new Set<string>()
  const walk = (parent: string | null, depth: number) => {
    for (const task of byParent.get(parent) ?? []) {
      if (seen.has(task.id)) continue
      seen.add(task.id)
      rows.push({ task, depth })
      if (depth < 4) walk(task.id, depth + 1)
    }
  }
  walk(null, 0)
  for (const task of tasks) if (!seen.has(task.id)) rows.push({ task, depth: 0 })
  return rows
}

/** Client-side narrowing for filters the server does not take, or before it answers. */
export function matchesFilters(task: TaskSummary, filters: TaskFilterValues): boolean {
  if (filters.status && !filters.status.split(',').includes(task.status)) return false
  if (filters.assignee && task.assignee !== filters.assignee && task.agent !== filters.assignee) return false
  if (filters.repository && task.repository?.id !== filters.repository) return false
  if (filters.q) {
    const needle = filters.q.toLowerCase()
    const haystack = `#${task.id} ${task.title} ${task.labels.join(' ')} ${task.github ? `${task.github.repository}#${task.github.number}` : ''}`.toLowerCase()
    if (!haystack.includes(needle)) return false
  }
  return true
}

/** Who is on it: the agent when one is, else the person. */
export function taskWorker(task: Pick<TaskSummary, 'assignee' | 'agent'>): { name: string; kind: 'agent' | 'human' } | null {
  if (task.agent) return { name: task.agent, kind: 'agent' }
  if (task.assignee) return { name: task.assignee, kind: 'human' }
  return null
}
