// Development sessions: who is working on what, since when, and what came out.

import { z } from 'zod'
import type { Sql } from 'postgres'
import { SESSION_ABANDON_AFTER_SECONDS, type SessionStatus } from 'portta-core'
import type { DatabaseClient } from './client.ts'

export interface SessionRow {
  id: string
  projectId: string
  taskId: string | null
  repositoryId: string | null
  environmentId: string | null
  actor: string
  actorKind: 'human' | 'agent'
  agent: string | null
  status: SessionStatus
  startedAt: Date
  lastActivityAt: Date
  endedAt: Date | null
  summary: string | null
  headBefore: string | null
  headAfter: string | null
  commits: Array<{ sha: string; subject: string; at: number }>
}

const Actor = z.string().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/)

export const StartSession = z.object({
  actor: Actor.optional(),
  actorKind: z.enum(['human', 'agent']).optional(),
  agent: z.string().max(64).nullable().default(null),
  taskId: z.string().min(1).max(64).nullable().default(null),
  repositoryId: z.string().min(1).max(64).nullable().default(null),
  environmentId: z.string().min(1).max(64).nullable().default(null),
  summary: z.string().max(2000).nullable().default(null),
  headBefore: z.string().max(64).nullable().default(null),
}).strict()

export const UpdateSession = z.object({
  status: z.enum(['active', 'ended', 'abandoned']).optional(),
  summary: z.string().max(2000).nullable().optional(),
  headAfter: z.string().max(64).nullable().optional(),
  taskId: z.string().min(1).max(64).nullable().optional(),
  environmentId: z.string().min(1).max(64).nullable().optional(),
  repositoryId: z.string().min(1).max(64).nullable().optional(),
  heartbeat: z.boolean().optional(),
}).strict()

const COLUMNS = `
  id::text AS "id", project_id::text AS "projectId", task_id::text AS "taskId", repository_id::text AS "repositoryId",
  environment_id::text AS "environmentId", actor AS "actor", actor_kind AS "actorKind", agent AS "agent", status AS "status",
  started_at AS "startedAt", last_activity_at AS "lastActivityAt", ended_at AS "endedAt", summary AS "summary",
  head_before AS "headBefore", head_after AS "headAfter", commits AS "commits"
`

export class SessionsRepository {
  private readonly sql: Sql

  constructor(client: DatabaseClient) {
    this.sql = client.handle
  }

  async list(filter: { projectId?: string; taskId?: string; status?: SessionStatus[]; limit?: number } = {}): Promise<SessionRow[]> {
    const sql = this.sql
    return sql<SessionRow[]>`
      SELECT ${sql.unsafe(COLUMNS)} FROM dev_sessions
      WHERE true
        ${filter.projectId ? sql`AND project_id = ${filter.projectId}` : sql``}
        ${filter.taskId ? sql`AND task_id = ${filter.taskId}` : sql``}
        ${filter.status && filter.status.length > 0 ? sql`AND status = ANY(${filter.status})` : sql``}
      ORDER BY last_activity_at DESC, id DESC
      LIMIT ${Math.min(Math.max(filter.limit ?? 100, 1), 1000)}
    `
  }

  async find(id: string): Promise<SessionRow | null> {
    const sql = this.sql
    const rows = await sql<SessionRow[]>`SELECT ${sql.unsafe(COLUMNS)} FROM dev_sessions WHERE id = ${id}`
    return rows[0] ?? null
  }

  async start(projectId: string, raw: unknown, actor: string, actorKind: 'human' | 'agent'): Promise<SessionRow> {
    const input = StartSession.parse(raw)
    const sql = this.sql
    const rows = await sql<SessionRow[]>`
      INSERT INTO dev_sessions (project_id, task_id, repository_id, environment_id, actor, actor_kind, agent, summary, head_before)
      VALUES (${projectId}, ${input.taskId}, ${input.repositoryId}, ${input.environmentId}, ${input.actor ?? actor}, ${input.actorKind ?? actorKind},
              ${input.agent}, ${input.summary}, ${input.headBefore})
      RETURNING ${sql.unsafe(COLUMNS)}
    `
    return rows[0]!
  }

  async update(id: string, raw: unknown): Promise<SessionRow | null> {
    const patch = UpdateSession.parse(raw)
    const current = await this.find(id)
    if (!current) return null
    const status = patch.status ?? current.status
    const ending = status !== 'active' && current.status === 'active'
    const sql = this.sql
    const rows = await sql<SessionRow[]>`
      UPDATE dev_sessions SET
        status = ${status},
        summary = ${patch.summary !== undefined ? patch.summary : current.summary},
        head_after = ${patch.headAfter !== undefined ? patch.headAfter : current.headAfter},
        task_id = ${patch.taskId !== undefined ? patch.taskId : current.taskId},
        environment_id = ${patch.environmentId !== undefined ? patch.environmentId : current.environmentId},
        repository_id = ${patch.repositoryId !== undefined ? patch.repositoryId : current.repositoryId},
        last_activity_at = now(),
        ended_at = ${ending ? sql`now()` : status === 'active' ? null : current.endedAt}
      WHERE id = ${id}
      RETURNING ${sql.unsafe(COLUMNS)}
    `
    return rows[0] ?? null
  }

  /** Record what a session produced, as the scan sees it. */
  async recordCommits(id: string, headAfter: string, commits: Array<{ sha: string; subject: string; at: number }>): Promise<void> {
    await this.sql`
      UPDATE dev_sessions SET head_after = ${headAfter}, commits = ${this.sql.json(commits)}, last_activity_at = now() WHERE id = ${id}
    `
  }

  /** Active sessions nobody touched for too long are abandoned, not active. */
  async abandonStale(now = new Date()): Promise<SessionRow[]> {
    const cutoff = new Date(now.getTime() - SESSION_ABANDON_AFTER_SECONDS * 1000)
    const sql = this.sql
    return sql<SessionRow[]>`
      UPDATE dev_sessions SET status = 'abandoned', ended_at = now()
      WHERE status = 'active' AND last_activity_at < ${cutoff}
      RETURNING ${sql.unsafe(COLUMNS)}
    `
  }
}
