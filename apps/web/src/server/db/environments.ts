import { z } from 'zod'
import type { DatabaseClient, EnvironmentRecord, EnvironmentRecordCounts, SeenEnvironment } from './client.ts'

const SeenEnvironmentSchema = z.object({
  composeProject: z.string().min(1).max(255),
  workingDir: z.string().min(1).nullable().optional(),
  repoUrl: z.string().min(1).nullable().optional(),
  repoSubpath: z.string().min(1).nullable().optional(),
}).strict()

/**
 * What this host has been observed running: one row per Compose project.
 *
 * An Environment is identity plus a cache of where it was last seen. It is
 * never deleted because a container vanished; only an explicit removal forgets
 * it (ADR 0013, ADR 0031).
 */
export class EnvironmentsRepository {
  private readonly client: DatabaseClient

  constructor(client: DatabaseClient) {
    this.client = client
  }

  upsertSeen(environment: SeenEnvironment): Promise<EnvironmentRecord> {
    return this.client.upsertSeen(SeenEnvironmentSchema.parse(environment))
  }

  list(): Promise<EnvironmentRecord[]> {
    return this.client.listEnvironments()
  }

  find(composeProject: string): Promise<EnvironmentRecord | null> {
    return this.client.findEnvironment(composeProject)
  }

  recordCounts(composeProject: string): Promise<EnvironmentRecordCounts> {
    return this.client.environmentRecordCounts(composeProject)
  }

  forget(composeProject: string): Promise<EnvironmentRecordCounts> {
    return this.client.forgetEnvironment(composeProject)
  }
}
