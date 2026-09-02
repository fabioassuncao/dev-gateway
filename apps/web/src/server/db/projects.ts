import { z } from 'zod'
import type { DatabaseClient, ProjectRecord, ProjectRecordCounts, SeenProject } from './client.ts'

const SeenProjectSchema = z.object({
  composeProject: z.string().min(1).max(255),
  workingDir: z.string().min(1).nullable().optional(),
  repoUrl: z.string().min(1).nullable().optional(),
  repoSubpath: z.string().min(1).nullable().optional(),
  slug: z.string().min(1).max(255).nullable().optional(),
}).strict()

export class ProjectsRepository {
  private readonly client: DatabaseClient

  constructor(client: DatabaseClient) {
    this.client = client
  }

  upsertSeen(project: SeenProject): Promise<ProjectRecord> {
    return this.client.upsertSeen(SeenProjectSchema.parse(project))
  }

  list(): Promise<ProjectRecord[]> {
    return this.client.listProjects()
  }

  find(composeProject: string): Promise<ProjectRecord | null> {
    return this.client.findProject(composeProject)
  }

  recordCounts(composeProject: string): Promise<ProjectRecordCounts> {
    return this.client.projectRecordCounts(composeProject)
  }

  forget(composeProject: string): Promise<ProjectRecordCounts> {
    return this.client.forgetProject(composeProject)
  }
}
