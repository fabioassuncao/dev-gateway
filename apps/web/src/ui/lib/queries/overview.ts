import { useQuery } from '@tanstack/react-query'
import { api } from '../api/index.ts'
import { keys } from './keys.ts'

/** The dashboard, refreshed as often as the metrics it carries. */
export function useDevelopmentOverview(enabled = true) {
  return useQuery({ queryKey: keys.developmentOverview(), queryFn: api.developmentOverview, retry: false, enabled, refetchInterval: 15_000 })
}

export function useProjectContext(slug: string, task: string | null = null, enabled = true) {
  return useQuery({ queryKey: keys.projectContext(slug, task), queryFn: () => api.projectContext(slug, task), retry: false, enabled })
}
