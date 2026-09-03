// Activity: what happened in the development flow, with references.

import type { JSONValue, Sql } from 'postgres'
import { ACTIVITY_KEEP_DAYS, ACTIVITY_KEEP_PER_PROJECT, type ActivityKind } from 'portta-core'
import type { DatabaseClient } from './client.ts'

export interface ActivityRow {
  id: string
  at: Date
  kind: ActivityKind
  actor: string | null
  actorKind: 'human' | 'agent' | 'system' | null
  projectId: string | null
  taskId: string | null
  repositoryId: string | null
  environmentId: string | null
  sessionId: string | null
  summary: string
  data: Record<string, unknown>
}

export interface ActivityInput {
  kind: ActivityKind
  summary: string
  actor?: string | null
  actorKind?: 'human' | 'agent' | 'system' | null
  projectId?: string | null
  taskId?: string | null
  repositoryId?: string | null
  environmentId?: string | null
  sessionId?: string | null
  data?: Record<string, unknown>
}

const COLUMNS = `
  id::text AS "id", at AS "at", kind AS "kind", actor AS "actor", actor_kind AS "actorKind",
  project_id::text AS "projectId", task_id::text AS "taskId", repository_id::text AS "repositoryId",
  environment_id::text AS "environmentId", session_id::text AS "sessionId", summary AS "summary", data AS "data"
`

export class ActivityRepository {
  private readonly sql: Sql

  constructor(client: DatabaseClient) {
    this.sql = client.handle
  }

  async append(input: ActivityInput): Promise<ActivityRow> {
    const sql = this.sql
    const rows = await sql<ActivityRow[]>`
      INSERT INTO activity_events (kind, actor, actor_kind, project_id, task_id, repository_id, environment_id, session_id, summary, data)
      VALUES (${input.kind}, ${input.actor ?? null}, ${input.actorKind ?? null}, ${input.projectId ?? null}, ${input.taskId ?? null},
              ${input.repositoryId ?? null}, ${input.environmentId ?? null}, ${input.sessionId ?? null}, ${input.summary}, ${sql.json((input.data ?? {}) as JSONValue)})
      RETURNING ${sql.unsafe(COLUMNS)}
    `
    return rows[0]!
  }

  async list(filter: { projectId?: string; taskId?: string; repositoryId?: string; environmentId?: string; sessionId?: string; kinds?: string[]; since?: Date; before?: string; limit?: number } = {}): Promise<ActivityRow[]> {
    const sql = this.sql
    return sql<ActivityRow[]>`
      SELECT ${sql.unsafe(COLUMNS)} FROM activity_events
      WHERE true
        ${filter.projectId ? sql`AND project_id = ${filter.projectId}` : sql``}
        ${filter.taskId ? sql`AND task_id = ${filter.taskId}` : sql``}
        ${filter.repositoryId ? sql`AND repository_id = ${filter.repositoryId}` : sql``}
        ${filter.environmentId ? sql`AND environment_id = ${filter.environmentId}` : sql``}
        ${filter.sessionId ? sql`AND session_id = ${filter.sessionId}` : sql``}
        ${filter.kinds && filter.kinds.length > 0 ? sql`AND kind = ANY(${filter.kinds})` : sql``}
        ${filter.since ? sql`AND at >= ${filter.since}` : sql``}
        ${filter.before ? sql`AND id < ${filter.before}` : sql``}
      ORDER BY at DESC, id DESC
      LIMIT ${Math.min(Math.max(filter.limit ?? 50, 1), 500)}
    `
  }

  /** Bounded history: by age, and by count per project. Called from a timer, never from a request. */
  async prune(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - ACTIVITY_KEEP_DAYS * 24 * 3600 * 1000)
    const byAge = await this.sql`DELETE FROM activity_events WHERE at < ${cutoff} RETURNING id`
    const byCount = await this.sql`
      DELETE FROM activity_events WHERE id IN (
        SELECT id FROM (
          SELECT id, row_number() OVER (PARTITION BY project_id ORDER BY at DESC, id DESC) AS rank
          FROM activity_events WHERE project_id IS NOT NULL
        ) ranked WHERE rank > ${ACTIVITY_KEEP_PER_PROJECT}
      ) RETURNING id
    `
    return byAge.length + byCount.length
  }
}
