'use client'

import { useQuery } from '@tanstack/react-query'
import { api, type TaskFilters } from '../api/index.ts'
import { keys } from './keys.ts'

export function useTasks(slug: string, filters: TaskFilters = {}, enabled = true) {
  return useQuery({ queryKey: keys.tasks(slug, filters), queryFn: () => api.tasks(slug, filters), retry: false, enabled })
}

/** One list: a project's tasks, or every task on the panel. */
export function useTasksList(slug: string | null, filters: TaskFilters = {}, enabled = true) {
  return useQuery({
    queryKey: slug ? keys.tasks(slug, filters) : keys.allTasks(filters),
    queryFn: () => slug ? api.tasks(slug, filters) : api.allTasks(filters),
    retry: false,
    enabled,
  })
}

export function useNextTask(slug: string, enabled = true) {
  return useQuery({ queryKey: keys.nextTask(slug), queryFn: () => api.nextTask(slug), retry: false, enabled })
}

export function useTask(id: string, enabled = true) {
  return useQuery({ queryKey: keys.task(id), queryFn: () => api.task(id), retry: false, enabled })
}

export function useSubtasks(id: string, enabled = true) {
  return useQuery({ queryKey: keys.taskSubtasks(id), queryFn: () => api.taskSubtasks(id), retry: false, enabled })
}
