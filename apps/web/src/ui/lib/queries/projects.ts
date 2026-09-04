import { useQueries, useQuery } from '@tanstack/react-query'
import type { Project } from 'portta-contracts'
import { api } from '../api/index.ts'
import { keys } from './keys.ts'

export function useProjects() {
  return useQuery({ queryKey: keys.projects(), queryFn: api.projects, retry: false })
}

export function useProject(slug: string, enabled = true) {
  return useQuery({ queryKey: keys.project(slug), queryFn: () => api.project(slug), retry: false, enabled: enabled && slug !== '' })
}

/**
 * Every Project with its repositories and environments: one request for the
 * list, one per project for the detail, all cached under the same keys the
 * project page uses. Projects are few on a development host; this is how a
 * page that starts from an environment finds the Project and the repository
 * it belongs to without a route the API does not have.
 */
export function useProjectDetails() {
  const summaries = useProjects()
  const slugs = (summaries.data ?? []).map((project) => project.slug)
  const details = useQueries({
    queries: slugs.map((slug) => ({ queryKey: keys.project(slug), queryFn: () => api.project(slug), retry: false })),
  })
  const projects = details.map((query) => query.data).filter((project): project is Project => project !== undefined)
  return {
    projects,
    isPending: summaries.isPending || details.some((query) => query.isPending),
    error: summaries.error ?? details.find((query) => query.error)?.error ?? null,
  }
}

export interface EnvironmentOwner {
  slug: string
  name: string
  repository: { id: string; name: string } | null
}

/** Which Project, and which of its repositories, an environment belongs to. */
export function useEnvironmentOwners() {
  const { projects, isPending, error } = useProjectDetails()
  const owners = new Map<string, EnvironmentOwner>()
  for (const project of projects) {
    for (const environment of project.environments) {
      const repository = project.repositories.find((candidate) => candidate.environments.includes(environment.environment)) ?? null
      owners.set(environment.environment, {
        slug: project.slug,
        name: project.name,
        repository: repository ? { id: repository.id, name: repository.name } : null,
      })
    }
  }
  return { owners, isPending, error }
}
