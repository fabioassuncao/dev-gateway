import { useQuery } from '@tanstack/react-query'
import { api, type TaskFilters } from '../api/index.ts'
import { keys } from './keys.ts'

export function useTasks(slug: string, filters: TaskFilters = {}, enabled = true) {
  return useQuery({ queryKey: keys.tasks(slug, filters), queryFn: () => api.tasks(slug, filters), retry: false, enabled })
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
