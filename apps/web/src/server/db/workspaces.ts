import { z } from 'zod'
import type {
  DatabaseClient,
  WorkspaceEnvironmentRow,
  WorkspaceRecord,
  WorkspaceRepositoryRow,
} from './client.ts'

const Slug = z.string().min(1).max(64).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'must be a lowercase slug')

const CreateWorkspace = z.object({
  slug: Slug,
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().default(null),
}).strict()

const UpdateWorkspace = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  archived: z.boolean().optional(),
}).strict()

/** Documented vocabulary, not an enum: adding one later is not a migration. */
export const REPOSITORY_ROLES = ['api', 'web', 'mobile', 'services', 'infra', 'docs', 'other'] as const

const RepositoryLink = z.object({
  repositoryId: z.string().min(1),
  role: z.string().max(32).nullable().default(null),
}).strict()

export class WorkspacesRepository {
  private readonly client: DatabaseClient

  constructor(client: DatabaseClient) {
    this.client = client
  }

  create(input: unknown): Promise<WorkspaceRecord> {
    return this.client.createWorkspace(CreateWorkspace.parse(input))
  }

  update(slug: string, patch: unknown): Promise<WorkspaceRecord | null> {
    return this.client.updateWorkspace(slug, UpdateWorkspace.parse(patch))
  }

  list(): Promise<WorkspaceRecord[]> {
    return this.client.listWorkspaces()
  }

  find(slug: string): Promise<WorkspaceRecord | null> {
    return this.client.findWorkspace(slug)
  }

  /** Removes the grouping only. No container, volume or repository is touched. */
  remove(slug: string): Promise<boolean> {
    return this.client.deleteWorkspace(slug)
  }

  listRepositories(): Promise<WorkspaceRepositoryRow[]> {
    return this.client.listWorkspaceRepositories()
  }

  setRepositories(workspaceId: string, repositories: unknown): Promise<void> {
    const parsed = z.array(RepositoryLink).max(64).parse(repositories)
    return this.client.setWorkspaceRepositories(workspaceId, parsed)
  }

  listEnvironments(): Promise<WorkspaceEnvironmentRow[]> {
    return this.client.listWorkspaceEnvironments()
  }

  setEnvironments(workspaceId: string, composeProjects: unknown): Promise<void> {
    const parsed = z.array(z.string().min(1).max(255)).max(128).parse(composeProjects)
    return this.client.setWorkspaceEnvironments(workspaceId, parsed)
  }
}

export type { WorkspaceRecord, WorkspaceRepositoryRow, WorkspaceEnvironmentRow }
