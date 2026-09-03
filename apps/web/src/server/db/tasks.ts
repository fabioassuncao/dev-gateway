// Tasks: Portta's own unit of work, and the optional binding to a GitHub issue.
//
// SQL lives here rather than in client.ts so the table's vocabulary has one
// home. Every id crosses the boundary as a string, every timestamp as a Date;
// the routes decide how they are presented.

import { z } from 'zod'
import type { Sql } from 'postgres'
import { TASK_PRIORITIES, TASK_STATUSES, TASK_SYNC_STATES, type TaskPriority, type TaskStatus, type TaskSyncState } from 'portta-core'
import type { DatabaseClient } from './client.ts'

export interface TaskRow {
  id: string
  projectId: string
  repositoryId: string | null
  environmentId: string | null
  service: string | null
  parentId: string | null
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority | null
  type: string | null
  labels: string[]
  assignee: string | null
  agent: string | null
  createdBy: string | null
  position: number
  createdAt: Date
  updatedAt: Date
  closedAt: Date | null
}

export interface TaskNoteRow {
  id: string
  taskId: string
  actor: string | null
  actorKind: 'human' | 'agent' | 'system'
  body: string
  createdAt: Date
}

export interface TaskGitHubLinkRow {
  taskId: string
  githubIssueId: string
  syncState: TaskSyncState
  lastSyncedAt: Date | null
  lastError: string | null
  localUpdatedAt: Date
  remoteUpdatedAt: Date | null
}

export interface TaskEnvironmentRow {
  taskId: string
  environmentId: string
  composeProject: string
  source: 'manual' | 'label' | 'branch' | 'namespace'
  branch: string | null
  linkedAt: Date
}

const Actor = z.string().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/)
const Labels = z.array(z.string().min(1).max(64)).max(32)

export const CreateTask = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(65536).nullable().default(null),
  status: z.enum(TASK_STATUSES).default('backlog'),
  priority: z.enum(TASK_PRIORITIES).nullable().default(null),
  type: z.string().max(32).nullable().default(null),
  labels: Labels.default([]),
  assignee: Actor.nullable().default(null),
  agent: Actor.nullable().default(null),
  parentId: z.string().min(1).max(64).nullable().default(null),
  repositoryId: z.string().min(1).max(64).nullable().default(null),
  environmentId: z.string().min(1).max(64).nullable().default(null),
  service: z.string().max(64).nullable().default(null),
}).strict()
export type CreateTaskInput = z.infer<typeof CreateTask>

export const UpdateTask = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(65536).nullable().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).nullable().optional(),
  type: z.string().max(32).nullable().optional(),
  labels: Labels.optional(),
  assignee: Actor.nullable().optional(),
  agent: Actor.nullable().optional(),
  parentId: z.string().min(1).max(64).nullable().optional(),
  repositoryId: z.string().min(1).max(64).nullable().optional(),
  environmentId: z.string().min(1).max(64).nullable().optional(),
  service: z.string().max(64).nullable().optional(),
  position: z.number().int().min(0).optional(),
}).strict()
export type UpdateTaskInput = z.infer<typeof UpdateTask>

export interface TaskFilter {
  projectId?: string
  repositoryId?: string
  environmentId?: string
  status?: TaskStatus[]
  assignee?: string
  parentId?: string | null
  open?: boolean
  q?: string
  limit?: number
}

const TASK_COLUMNS = `
  t.id::text AS "id", t.project_id::text AS "projectId", t.repository_id::text AS "repositoryId",
  t.environment_id::text AS "environmentId", t.service AS "service", t.parent_id::text AS "parentId",
  t.title AS "title", t.description AS "description", t.status AS "status", t.priority AS "priority",
  t.type AS "type", t.labels AS "labels", t.assignee AS "assignee", t.agent AS "agent",
  t.created_by AS "createdBy", t.position AS "position", t.created_at AS "createdAt",
  t.updated_at AS "updatedAt", t.closed_at AS "closedAt"
`

export class TasksRepository {
  private readonly sql: Sql

  constructor(client: DatabaseClient) {
    this.sql = client.handle
  }

  async list(filter: TaskFilter = {}): Promise<TaskRow[]> {
    const sql = this.sql
    const statuses = filter.status && filter.status.length > 0 ? filter.status : null
    const rows = await sql<TaskRow[]>`
      SELECT ${sql.unsafe(TASK_COLUMNS)}
      FROM tasks t
      WHERE true
        ${filter.projectId ? sql`AND t.project_id = ${filter.projectId}` : sql``}
        ${filter.repositoryId ? sql`AND t.repository_id = ${filter.repositoryId}` : sql``}
        ${filter.environmentId ? sql`AND t.environment_id = ${filter.environmentId}` : sql``}
        ${statuses ? sql`AND t.status = ANY(${statuses})` : sql``}
        ${filter.assignee ? sql`AND t.assignee = ${filter.assignee}` : sql``}
        ${filter.parentId === null ? sql`AND t.parent_id IS NULL` : filter.parentId ? sql`AND t.parent_id = ${filter.parentId}` : sql``}
        ${filter.open === true ? sql`AND t.status <> 'done'` : filter.open === false ? sql`AND t.status = 'done'` : sql``}
        ${filter.q ? sql`AND (t.title ILIKE ${`%${filter.q}%`} OR t.description ILIKE ${`%${filter.q}%`})` : sql``}
      ORDER BY t.position, t.updated_at DESC, t.id
      LIMIT ${Math.min(Math.max(filter.limit ?? 500, 1), 2000)}
    `
    return rows.map(normalise)
  }

  async find(id: string): Promise<TaskRow | null> {
    const sql = this.sql
    const rows = await sql<TaskRow[]>`SELECT ${sql.unsafe(TASK_COLUMNS)} FROM tasks t WHERE t.id = ${id}`
    return rows[0] ? normalise(rows[0]) : null
  }

  async findByIssue(githubIssueId: string): Promise<TaskRow | null> {
    const sql = this.sql
    const rows = await sql<TaskRow[]>`
      SELECT ${sql.unsafe(TASK_COLUMNS)} FROM tasks t
      JOIN task_github_links l ON l.task_id = t.id
      WHERE l.github_issue_id = ${githubIssueId}
    `
    return rows[0] ? normalise(rows[0]) : null
  }

  async create(projectId: string, raw: unknown, createdBy: string | null): Promise<TaskRow> {
    const input = CreateTask.parse(raw)
    const sql = this.sql
    const rows = await sql<TaskRow[]>`
      INSERT INTO tasks (project_id, repository_id, environment_id, service, parent_id, title, description, status, priority, type, labels, assignee, agent, created_by, closed_at)
      VALUES (${projectId}, ${input.repositoryId}, ${input.environmentId}, ${input.service}, ${input.parentId}, ${input.title}, ${input.description},
              ${input.status}, ${input.priority}, ${input.type}, ${sql.json(input.labels)}, ${input.assignee}, ${input.agent}, ${createdBy},
              ${input.status === 'done' ? sql`now()` : null})
      RETURNING ${sql.unsafe(TASK_COLUMNS.replaceAll('t.', ''))}
    `
    return normalise(rows[0]!)
  }

  async update(id: string, raw: unknown): Promise<TaskRow | null> {
    const patch = UpdateTask.parse(raw)
    const current = await this.find(id)
    if (!current) return null
    const next = { ...current, ...patch }
    const sql = this.sql
    const rows = await sql<TaskRow[]>`
      UPDATE tasks SET
        title = ${next.title}, description = ${next.description}, status = ${next.status}, priority = ${next.priority},
        type = ${next.type}, labels = ${sql.json(next.labels)}, assignee = ${next.assignee}, agent = ${next.agent},
        parent_id = ${next.parentId}, repository_id = ${next.repositoryId}, environment_id = ${next.environmentId},
        service = ${next.service}, position = ${next.position},
        closed_at = ${next.status === 'done' ? (current.closedAt ?? sql`now()`) : null},
        updated_at = now()
      WHERE id = ${id}
      RETURNING ${sql.unsafe(TASK_COLUMNS.replaceAll('t.', ''))}
    `
    return rows[0] ? normalise(rows[0]) : null
  }

  async remove(id: string): Promise<boolean> {
    const rows = await this.sql`DELETE FROM tasks WHERE id = ${id} RETURNING id`
    return rows.length > 0
  }

  async countByProject(): Promise<Map<string, { open: number; inProgress: number; blocked: number; review: number; done: number }>> {
    const rows = await this.sql<Array<{ projectId: string; status: TaskStatus; count: string }>>`
      SELECT project_id::text AS "projectId", status AS "status", count(*)::text AS "count"
      FROM tasks GROUP BY project_id, status
    `
    const map = new Map<string, { open: number; inProgress: number; blocked: number; review: number; done: number }>()
    for (const row of rows) {
      const entry = map.get(row.projectId) ?? { open: 0, inProgress: 0, blocked: 0, review: 0, done: 0 }
      const count = Number(row.count)
      if (row.status === 'done') entry.done += count
      else {
        entry.open += count
        if (row.status === 'in_progress') entry.inProgress += count
        if (row.status === 'blocked') entry.blocked += count
        if (row.status === 'review') entry.review += count
      }
      map.set(row.projectId, entry)
    }
    return map
  }

  // --- notes ---------------------------------------------------------------

  async listNotes(taskId: string): Promise<TaskNoteRow[]> {
    return this.sql<TaskNoteRow[]>`
      SELECT id::text AS "id", task_id::text AS "taskId", actor AS "actor", actor_kind AS "actorKind", body AS "body", created_at AS "createdAt"
      FROM task_notes WHERE task_id = ${taskId} ORDER BY created_at, id
    `
  }

  async addNote(taskId: string, body: string, actor: string | null, actorKind: 'human' | 'agent' | 'system'): Promise<TaskNoteRow> {
    const text = z.string().min(1).max(65536).parse(body)
    const rows = await this.sql<TaskNoteRow[]>`
      INSERT INTO task_notes (task_id, actor, actor_kind, body) VALUES (${taskId}, ${actor}, ${actorKind}, ${text})
      RETURNING id::text AS "id", task_id::text AS "taskId", actor AS "actor", actor_kind AS "actorKind", body AS "body", created_at AS "createdAt"
    `
    await this.sql`UPDATE tasks SET updated_at = now() WHERE id = ${taskId}`
    return rows[0]!
  }

  // --- GitHub binding ------------------------------------------------------

  async findLink(taskId: string): Promise<TaskGitHubLinkRow | null> {
    const rows = await this.sql<TaskGitHubLinkRow[]>`
      SELECT task_id::text AS "taskId", github_issue_id::text AS "githubIssueId", sync_state AS "syncState",
             last_synced_at AS "lastSyncedAt", last_error AS "lastError", local_updated_at AS "localUpdatedAt", remote_updated_at AS "remoteUpdatedAt"
      FROM task_github_links WHERE task_id = ${taskId}
    `
    return rows[0] ?? null
  }

  async listLinks(taskIds?: string[]): Promise<TaskGitHubLinkRow[]> {
    const sql = this.sql
    return sql<TaskGitHubLinkRow[]>`
      SELECT task_id::text AS "taskId", github_issue_id::text AS "githubIssueId", sync_state AS "syncState",
             last_synced_at AS "lastSyncedAt", last_error AS "lastError", local_updated_at AS "localUpdatedAt", remote_updated_at AS "remoteUpdatedAt"
      FROM task_github_links
      ${taskIds ? sql`WHERE task_id = ANY(${taskIds.map(Number)})` : sql``}
    `
  }

  async upsertLink(link: {
    taskId: string
    githubIssueId: string
    syncState: TaskSyncState
    lastSyncedAt?: Date | null
    lastError?: string | null
    localUpdatedAt?: Date
    remoteUpdatedAt?: Date | null
  }): Promise<void> {
    z.enum(TASK_SYNC_STATES).parse(link.syncState)
    await this.sql`
      INSERT INTO task_github_links (task_id, github_issue_id, sync_state, last_synced_at, last_error, local_updated_at, remote_updated_at)
      VALUES (${link.taskId}, ${link.githubIssueId}, ${link.syncState}, ${link.lastSyncedAt ?? null}, ${link.lastError ?? null},
              ${link.localUpdatedAt ?? new Date()}, ${link.remoteUpdatedAt ?? null})
      ON CONFLICT (task_id) DO UPDATE SET
        github_issue_id = EXCLUDED.github_issue_id,
        sync_state = EXCLUDED.sync_state,
        last_synced_at = EXCLUDED.last_synced_at,
        last_error = EXCLUDED.last_error,
        local_updated_at = EXCLUDED.local_updated_at,
        remote_updated_at = EXCLUDED.remote_updated_at
    `
  }

  async setLinkState(taskId: string, state: TaskSyncState, detail: { lastError?: string | null; lastSyncedAt?: Date | null; remoteUpdatedAt?: Date | null; localUpdatedAt?: Date } = {}): Promise<void> {
    const sql = this.sql
    await sql`
      UPDATE task_github_links SET
        sync_state = ${state},
        last_error = ${detail.lastError ?? null},
        last_synced_at = COALESCE(${detail.lastSyncedAt ?? null}, last_synced_at),
        remote_updated_at = COALESCE(${detail.remoteUpdatedAt ?? null}, remote_updated_at),
        local_updated_at = COALESCE(${detail.localUpdatedAt ?? null}, local_updated_at)
      WHERE task_id = ${taskId}
    `
  }

  async removeLink(taskId: string): Promise<boolean> {
    const rows = await this.sql`DELETE FROM task_github_links WHERE task_id = ${taskId} RETURNING task_id`
    return rows.length > 0
  }

  // --- environments --------------------------------------------------------

  async listEnvironments(taskIds?: string[]): Promise<TaskEnvironmentRow[]> {
    const sql = this.sql
    return sql<TaskEnvironmentRow[]>`
      SELECT te.task_id::text AS "taskId", te.environment_id::text AS "environmentId", e.compose_project AS "composeProject",
             te.source AS "source", te.branch AS "branch", te.linked_at AS "linkedAt"
      FROM task_environments te JOIN environments e ON e.id = te.environment_id
      ${taskIds ? sql`WHERE te.task_id = ANY(${taskIds.map(Number)})` : sql``}
      ORDER BY te.linked_at
    `
  }

  /** Replace the manual links of one task. Inferred links are never stored. */
  async setEnvironments(taskId: string, composeProjects: string[]): Promise<void> {
    const names = z.array(z.string().min(1).max(255)).max(64).parse(composeProjects)
    await this.sql.begin(async (tx) => {
      await tx`DELETE FROM task_environments WHERE task_id = ${taskId} AND source = 'manual'`
      for (const name of names) {
        await tx`
          INSERT INTO task_environments (task_id, environment_id, source)
          SELECT ${taskId}, e.id, 'manual' FROM environments e WHERE e.compose_project = ${name}
          ON CONFLICT (environment_id) DO UPDATE SET task_id = EXCLUDED.task_id, source = 'manual', linked_at = now()
        `
      }
    })
  }
}

function normalise(row: TaskRow): TaskRow {
  return { ...row, labels: Array.isArray(row.labels) ? row.labels.map(String) : [], position: Number(row.position) }
}
