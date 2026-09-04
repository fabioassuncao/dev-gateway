import { z } from 'zod'
import { parseRelativeProjectPath } from 'portta-core'
import type {
  DatabaseClient,
  ProjectEnvironmentRow,
  ProjectRecord,
} from './client.ts'

const Slug = z.string().min(1).max(64).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'must be a lowercase slug')

/**
 * The first-level directory under Projects Home, never an absolute path and
 * never the identity (ADR 0031). Validated the same way the core does.
 */
const RelativePath = z.string().transform((value, ctx) => {
  try {
    return parseRelativeProjectPath(value)
  } catch (error) {
    ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'invalid relative path' })
    return z.NEVER
  }
})

const CreateProject = z.object({
  slug: Slug,
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().default(null),
  relativePath: RelativePath.nullable().default(null),
}).strict()

const UpdateProject = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  archived: z.boolean().optional(),
  relativePath: RelativePath.nullable().optional(),
}).strict()

/**
 * The product the operator recognises. A decision, so nothing on the snapshot
 * path writes here and nothing here disappears when nothing is running.
 */
export class ProjectsRepository {
  private readonly client: DatabaseClient

  constructor(client: DatabaseClient) {
    this.client = client
  }

  create(input: unknown): Promise<ProjectRecord> {
    return this.client.createProject(CreateProject.parse(input))
  }

  update(slug: string, patch: unknown): Promise<ProjectRecord | null> {
    return this.client.updateProject(slug, UpdateProject.parse(patch))
  }

  list(): Promise<ProjectRecord[]> {
    return this.client.listProjects()
  }

  find(slug: string): Promise<ProjectRecord | null> {
    return this.client.findProject(slug)
  }

  /** Removes the grouping only. No container, volume or repository is touched. */
  remove(slug: string): Promise<boolean> {
    return this.client.deleteProject(slug)
  }

  listEnvironments(): Promise<ProjectEnvironmentRow[]> {
    return this.client.listProjectEnvironments()
  }

  setEnvironments(projectId: string, composeProjects: unknown): Promise<void> {
    const parsed = z.array(z.string().min(1).max(255)).max(128).parse(composeProjects)
    return this.client.setProjectEnvironments(projectId, parsed)
  }
}

export type { ProjectRecord, ProjectEnvironmentRow }
export { REPOSITORY_ROLES } from './repositories.ts'
