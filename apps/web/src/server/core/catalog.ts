// Assemble a Project from the persisted grouping plus the live Environment
// snapshot. See docs/adr/0031-projects-home-and-project.md.

import { relativePathFromWorkingDir, resolveProjectPath } from 'portta-core'
import type { Snapshot } from './inventory.ts'
import { resolveAdoptions, type ProjectCoordinates } from './adoption.ts'
import type { Database } from '../db/index.ts'
import type { ProjectRecord, ProjectRepositoryRow } from '../db/client.ts'
import type {
  Project,
  ProjectEnvironment,
  ProjectGitHubRepository,
  ProjectLocation,
  ProjectSummary,
} from '../../shared/types.ts'

/** The panel cannot stat the host: with a stored path it is managed, without one it is external. */
export function projectLocationOf(relativePath: string | null): ProjectLocation {
  return relativePath ? 'managed' : 'external'
}

export function resolvedPathOf(projectsHome: string | null, relativePath: string | null): string | null {
  if (!projectsHome || !relativePath) return null
  try {
    return resolveProjectPath(projectsHome, relativePath)
  } catch {
    return null
  }
}

export function toGitHubRepository(row: ProjectRepositoryRow): ProjectGitHubRepository {
  return {
    repositoryId: row.repositoryId,
    fullName: row.fullName,
    htmlUrl: row.htmlUrl,
    defaultBranch: row.defaultBranch,
    private: row.private,
    archived: row.archived,
    role: row.role,
    position: row.position,
  }
}

export function toProjectSummary(
  record: ProjectRecord,
  githubCount: number,
  adopted: ProjectEnvironment[],
): ProjectSummary {
  return {
    id: record.id,
    slug: record.slug,
    name: record.name,
    description: record.description,
    archived: record.archived,
    relativePath: record.relativePath,
    location: projectLocationOf(record.relativePath),
    repositoryCount: githubCount,
    environmentCount: adopted.length,
    runningEnvironmentCount: adopted.filter((environment) => environment.running).length,
  }
}

export function toProject(
  record: ProjectRecord,
  github: ProjectGitHubRepository[],
  adopted: ProjectEnvironment[],
  projectsHome: string | null,
): Project {
  return {
    id: record.id,
    slug: record.slug,
    name: record.name,
    description: record.description,
    archived: record.archived,
    relativePath: record.relativePath,
    resolvedPath: resolvedPathOf(projectsHome, record.relativePath),
    location: projectLocationOf(record.relativePath),
    repositories: [],
    githubRepositories: github,
    environments: adopted,
  }
}

export async function loadProjectCatalog(db: Database, snapshot: Snapshot, projectsHome: string | null) {
  const [records, repositoryRows, manualLinks] = await Promise.all([
    db.projects.list(),
    db.projects.listRepositories(),
    db.projects.listEnvironments(),
  ])

  const githubByProject = new Map<string, ProjectGitHubRepository[]>()
  for (const row of repositoryRows) {
    const list = githubByProject.get(row.projectId) ?? []
    list.push(toGitHubRepository(row))
    githubByProject.set(row.projectId, list)
  }

  const coordinates: ProjectCoordinates[] = records.map((record) => ({
    id: record.id,
    slug: record.slug,
    repositories: (githubByProject.get(record.id) ?? []).map((repository) => repository.fullName.toLowerCase()),
  }))

  const manual = new Map(manualLinks.map((row) => [row.composeProject, row.projectId]))
  const adoptions = resolveAdoptions(snapshot.environments, coordinates, manual)

  const environments = new Map<string, ProjectEnvironment[]>()
  for (const environment of snapshot.environments) {
    const adoption = adoptions.get(environment.name)
    if (!adoption) continue
    const list = environments.get(adoption.projectId) ?? []
    list.push({
      environment: environment.name,
      source: adoption.source,
      attribution: 'resolved',
      running: environment.runningCount > 0,
      serviceCount: environment.serviceCount,
      runningCount: environment.runningCount,
      unhealthyCount: environment.unhealthyCount,
      urls: environment.urls,
    })
    environments.set(adoption.projectId, list)
  }

  return { records, githubByProject, environments, projectsHome }
}

/** Safe backfill: only when working_dir is an unambiguous child of Projects Home. */
export function inferredRelativePath(projectsHome: string | null, workingDir: string | null): string | null {
  if (!projectsHome || !workingDir) return null
  return relativePathFromWorkingDir(projectsHome, workingDir)
}
