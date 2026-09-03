// Work: Portta's own tasks, and the optional GitHub binding on top of them.

import type { Task, TaskSummary } from '../../../shared/task-types.ts'
import { request } from './client.ts'

export type TaskFilters = Partial<Record<'status' | 'open' | 'assignee' | 'repository' | 'parent' | 'q', string>>

export interface TaskBody {
  title?: string
  description?: string | null
  status?: string
  priority?: string | null
  type?: string | null
  labels?: string[]
  assignee?: string | null
  agent?: string | null
  parentId?: string | null
  repositoryId?: string | null
  environmentId?: string | null
  service?: string | null
  position?: number
}

export interface SubtaskNode {
  task: TaskSummary
  children: SubtaskNode[]
}

function query(filters: Record<string, string | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value)
  const suffix = params.toString()
  return suffix ? `?${suffix}` : ''
}

const ref = (value: string) => encodeURIComponent(value)
const slugOf = (value: string) => encodeURIComponent(value)

export const tasksApi = {
  tasks: (slug: string, filters: TaskFilters = {}) =>
    request<{ tasks: TaskSummary[] }>(`/projects/${slugOf(slug)}/tasks${query(filters)}`).then((data) => data.tasks),
  nextTask: (slug: string) =>
    request<{ task: TaskSummary | null }>(`/projects/${slugOf(slug)}/tasks/next`).then((data) => data.task),
  createTask: (slug: string, body: TaskBody) =>
    request<Task>(`/projects/${slugOf(slug)}/tasks`, { method: 'POST', body: JSON.stringify(body) }),
  task: (id: string) => request<Task>(`/tasks/${ref(id)}`),
  patchTask: (id: string, body: TaskBody) =>
    request<Task>(`/tasks/${ref(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteTask: (id: string) => request<{ ok: boolean }>(`/tasks/${ref(id)}`, { method: 'DELETE', body: '{}' }),
  taskSubtasks: (id: string) =>
    request<{ subtasks: SubtaskNode[] }>(`/tasks/${ref(id)}/subtasks`).then((data) => data.subtasks),
  taskNotes: (id: string) => request<{ notes: Task['notes'] }>(`/tasks/${ref(id)}/notes`).then((data) => data.notes),
  addTaskNote: (id: string, body: string) =>
    request<Task['notes'][number]>(`/tasks/${ref(id)}/notes`, { method: 'POST', body: JSON.stringify({ body }) }),
  startTask: (id: string, assign?: boolean) =>
    request<Task>(`/tasks/${ref(id)}/start`, { method: 'POST', body: JSON.stringify(assign === undefined ? {} : { assign }) }),
  setTaskStatus: (id: string, status: string) =>
    request<Task>(`/tasks/${ref(id)}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
  finishTask: (id: string, close?: boolean) =>
    request<Task>(`/tasks/${ref(id)}/finish`, { method: 'POST', body: JSON.stringify(close === undefined ? {} : { close }) }),
  setTaskEnvironments: (id: string, environments: string[]) =>
    request<Task>(`/tasks/${ref(id)}/environments`, { method: 'PUT', body: JSON.stringify({ environments }) }),
  linkTaskGitHub: (id: string, issue: string) =>
    request<Task>(`/tasks/${ref(id)}/github/link`, { method: 'POST', body: JSON.stringify({ issue }) }),
  unlinkTaskGitHub: (id: string) =>
    request<Task>(`/tasks/${ref(id)}/github/unlink`, { method: 'POST', body: '{}' }),
  publishTaskGitHub: (id: string, body: { repository?: string } = {}) =>
    request<Task>(`/tasks/${ref(id)}/github/publish`, { method: 'POST', body: JSON.stringify(body) }),
  syncTaskGitHub: (id: string, resolve?: 'local' | 'remote') =>
    request<Task>(`/tasks/${ref(id)}/github/sync`, { method: 'POST', body: JSON.stringify(resolve ? { resolve } : {}) }),
  commentTaskGitHub: (id: string, body: string) =>
    request<{ id: number; htmlUrl: string }>(`/tasks/${ref(id)}/comments`, { method: 'POST', body: JSON.stringify({ body }) }),
}
