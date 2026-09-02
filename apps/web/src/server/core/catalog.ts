// Assemble a Project from the persisted grouping (still stored as `workspaces`)
// plus the live Environment snapshot. Persistence names stay in db/; this
// file speaks the canonical domain. See docs/adr/0031-projects-home-and-project.md.

import { relativePathFromWorkingDir, resolveProjectPath } from 'portta-core'
import type { Snapshot } from './inventory.ts'
import { resolveAdoptions, type WorkspaceCoordinates } from './adoption.ts'
import type { Database } from '../db/index.ts'
import type { WorkspaceRecord, WorkspaceRepositoryRow } from '../db/client.ts'
import type {
  Project,
  ProjectEnvironment,
  ProjectGitHubRepository,
  ProjectLocation,
  ProjectSummary,
} from '../../shared/types.ts'

export function projectLocationOf(relativePath: string | null): ProjectLocation {
  return relativePath ? 'managed' : 'unmanaged'
}

export function resolvedPathOf(projectsHome: string | null, relativePath: string | null): string | null {
  if (!projectsHome || !relativePath) return null
  try {
    return resolveProjectPath(projectsHome, relativePath)
  } catch {
    return null
  }
}

export function toGitHubRepository(row: WorkspaceRepositoryRow): ProjectGitHubRepository {
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
  record: WorkspaceRecord,
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
  record: WorkspaceRecord,
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
    db.workspaces.list(),
    db.workspaces.listRepositories(),
    db.workspaces.listEnvironments(),
  ])

  const githubByProject = new Map<string, ProjectGitHubRepository[]>()
  for (const row of repositoryRows) {
    const list = githubByProject.get(row.workspaceId) ?? []
    list.push(toGitHubRepository(row))
    githubByProject.set(row.workspaceId, list)
  }

  const coordinates: WorkspaceCoordinates[] = records.map((record) => ({
    id: record.id,
    slug: record.slug,
    repositories: (githubByProject.get(record.id) ?? []).map((repository) => repository.fullName.toLowerCase()),
  }))

  const manual = new Map(manualLinks.map((row) => [row.composeProject, row.workspaceId]))
  const adoptions = resolveAdoptions(snapshot.environments, coordinates, manual)

  const environments = new Map<string, ProjectEnvironment[]>()
  for (const environment of snapshot.environments) {
    const adoption = adoptions.get(environment.name)
    if (!adoption) continue
    const list = environments.get(adoption.workspaceId) ?? []
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
    environments.set(adoption.workspaceId, list)
  }

  return { records, githubByProject, environments, projectsHome }
}

/** Safe backfill: only when working_dir is an unambiguous child of Projects Home. */
export function inferredRelativePath(projectsHome: string | null, workingDir: string | null): string | null {
  if (!projectsHome || !workingDir) return null
  return relativePathFromWorkingDir(projectsHome, workingDir)
}
