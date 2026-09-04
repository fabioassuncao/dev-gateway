// Tasks: Portta's own unit of work, and the optional binding to a GitHub issue.
//
// SQL lives here rather than in client.ts so the table's vocabulary has one
// home. Every id crosses the boundary as a string, every timestamp as a Date;
// the routes decide how they are presented.

import { z } from 'zod'
import type { Sql } from 'postgres'
import { isIntactDraft, TASK_PRIORITIES, TASK_STATUSES, TASK_SYNC_STATES, type TaskPriority, type TaskStatus, type TaskSyncState } from 'portta-core'
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
  dueAt: Date | null
  sourceKey: string | null
  draft: boolean
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
  sourceKey: string | null
  createdAt: Date
  updatedAt: Date | null
  githubCommentId: number | null
  githubHtmlUrl: string | null
  publishState: 'local' | 'pending' | 'synced' | 'error'
  publishError: string | null
}

/**
 * An attachment's metadata. The bytes are deliberately not on this row: every
 * listing would carry megabytes it never uses, so `readAttachment` is a
 * separate, explicit read.
 */
export interface TaskAttachmentRow {
  id: string
  taskId: string
  filename: string
  contentType: string
  sizeBytes: number
  actor: string | null
  actorKind: 'human' | 'agent' | 'system'
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
  dueAt: z.coerce.date().nullable().default(null),
  sourceKey: z.string().min(1).max(80).nullable().default(null),
  draft: z.boolean().default(false),
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
  dueAt: z.coerce.date().nullable().optional(),
  sourceKey: z.string().min(1).max(80).nullable().optional(),
  draft: z.boolean().optional(),
}).strict()
export type UpdateTaskInput = z.infer<typeof UpdateTask>

export interface TaskFilter {
  projectId?: string
  repositoryId?: string
  environmentId?: string
  status?: TaskStatus[]
  assignee?: string
  agent?: string
  priority?: TaskPriority[]
  type?: string
  label?: string
  service?: string
  parentId?: string | null
  open?: boolean
  q?: string
  draft?: boolean
  createdBy?: string | null
  sourceKey?: string
  limit?: number
}

const TASK_COLUMNS = `
  t.id::text AS "id", t.project_id::text AS "projectId", t.repository_id::text AS "repositoryId",
  t.environment_id::text AS "environmentId", t.service AS "service", t.parent_id::text AS "parentId",
  t.title AS "title", t.description AS "description", t.status AS "status", t.priority AS "priority",
  t.type AS "type", t.labels AS "labels", t.assignee AS "assignee", t.agent AS "agent",
  t.created_by AS "createdBy", t.position AS "position", t.due_at AS "dueAt",
  t.source_key AS "sourceKey", t.draft AS "draft", t.created_at AS "createdAt",
  t.updated_at AS "updatedAt", t.closed_at AS "closedAt"
`

const ATTACHMENT_COLUMNS = `
  id::text AS "id", task_id::text AS "taskId", filename AS "filename",
  content_type AS "contentType", size_bytes::int AS "sizeBytes",
  actor AS "actor", actor_kind AS "actorKind", created_at AS "createdAt"
`

export class TasksRepository {
  private readonly sql: Sql

  constructor(client: DatabaseClient) {
    this.sql = client.handle
  }

  async list(filter: TaskFilter = {}): Promise<TaskRow[]> {
    const sql = this.sql
    const statuses = filter.status && filter.status.length > 0 ? filter.status : null
    const priorities = filter.priority && filter.priority.length > 0 ? filter.priority : null
    const rows = await sql<TaskRow[]>`
      SELECT ${sql.unsafe(TASK_COLUMNS)}
      FROM tasks t
      WHERE true
        ${filter.projectId ? sql`AND t.project_id = ${filter.projectId}` : sql``}
        ${filter.repositoryId ? sql`AND t.repository_id = ${filter.repositoryId}` : sql``}
        ${filter.environmentId ? sql`AND t.environment_id = ${filter.environmentId}` : sql``}
        ${statuses ? sql`AND t.status = ANY(${statuses})` : sql``}
        ${priorities ? sql`AND t.priority = ANY(${priorities})` : sql``}
        ${filter.assignee ? sql`AND t.assignee = ${filter.assignee}` : sql``}
        ${filter.agent ? sql`AND t.agent = ${filter.agent}` : sql``}
        ${filter.type ? sql`AND t.type = ${filter.type}` : sql``}
        ${filter.label ? sql`AND t.labels @> ${sql.json([filter.label])}` : sql``}
        ${filter.service ? sql`AND t.service = ${filter.service}` : sql``}
        ${filter.parentId === null ? sql`AND t.parent_id IS NULL` : filter.parentId ? sql`AND t.parent_id = ${filter.parentId}` : sql``}
        ${filter.open === true ? sql`AND t.status <> 'done'` : filter.open === false ? sql`AND t.status = 'done'` : sql``}
        ${filter.draft === false ? sql`AND t.draft = false` : filter.draft === true ? sql`AND t.draft = true` : sql``}
        ${filter.createdBy !== undefined ? sql`AND t.created_by IS NOT DISTINCT FROM ${filter.createdBy}` : sql``}
        ${filter.sourceKey ? sql`AND t.source_key = ${filter.sourceKey}` : sql``}
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
    return sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`task-board:${projectId}:${input.status}`}, 0))`
      const rows = await tx<TaskRow[]>`
        INSERT INTO tasks (project_id, repository_id, environment_id, service, parent_id, title, description, status, priority, type, labels, assignee, agent, created_by, position, due_at, source_key, draft, closed_at)
        VALUES (${projectId}, ${input.repositoryId}, ${input.environmentId}, ${input.service}, ${input.parentId}, ${input.title}, ${input.description},
                ${input.status}, ${input.priority}, ${input.type}, ${tx.json(input.labels)}, ${input.assignee}, ${input.agent}, ${createdBy},
                COALESCE((SELECT max(position) + 1024 FROM tasks WHERE project_id = ${projectId} AND status = ${input.status}), 1024),
                ${input.dueAt}, ${input.sourceKey}, ${input.draft},
                ${input.status === 'done' ? tx`now()` : null})
        RETURNING ${tx.unsafe(TASK_COLUMNS.replaceAll('t.', ''))}
      `
      return normalise(rows[0]!)
    })
  }

  async update(id: string, raw: unknown): Promise<TaskRow | null> {
    const patch = UpdateTask.parse(raw)
    const sql = this.sql
    const rows = await sql<TaskRow[]>`
      UPDATE tasks SET
        title = CASE WHEN ${patch.title !== undefined} THEN ${patch.title ?? ''} ELSE title END,
        description = CASE WHEN ${patch.description !== undefined} THEN ${patch.description ?? null} ELSE description END,
        status = CASE WHEN ${patch.status !== undefined} THEN ${patch.status ?? 'backlog'} ELSE status END,
        priority = CASE WHEN ${patch.priority !== undefined} THEN ${patch.priority ?? null} ELSE priority END,
        type = CASE WHEN ${patch.type !== undefined} THEN ${patch.type ?? null} ELSE type END,
        labels = CASE WHEN ${patch.labels !== undefined} THEN ${sql.json(patch.labels ?? [])} ELSE labels END,
        assignee = CASE WHEN ${patch.assignee !== undefined} THEN ${patch.assignee ?? null} ELSE assignee END,
        agent = CASE WHEN ${patch.agent !== undefined} THEN ${patch.agent ?? null} ELSE agent END,
        parent_id = CASE WHEN ${patch.parentId !== undefined} THEN ${patch.parentId ?? null} ELSE parent_id END,
        repository_id = CASE WHEN ${patch.repositoryId !== undefined} THEN ${patch.repositoryId ?? null} ELSE repository_id END,
        environment_id = CASE WHEN ${patch.environmentId !== undefined} THEN ${patch.environmentId ?? null} ELSE environment_id END,
        service = CASE WHEN ${patch.service !== undefined} THEN ${patch.service ?? null} ELSE service END,
        position = CASE WHEN ${patch.position !== undefined} THEN ${patch.position ?? 0} ELSE position END,
        due_at = CASE WHEN ${patch.dueAt !== undefined} THEN ${patch.dueAt ?? null} ELSE due_at END,
        source_key = CASE WHEN ${patch.sourceKey !== undefined} THEN ${patch.sourceKey ?? null} ELSE source_key END,
        draft = CASE WHEN ${patch.draft !== undefined} THEN ${patch.draft ?? false} ELSE draft END,
        closed_at = CASE
          WHEN ${patch.status === 'done'} THEN COALESCE(closed_at, now())
          WHEN ${patch.status !== undefined} THEN NULL
          ELSE closed_at
        END,
        updated_at = now()
      WHERE id = ${id}
      RETURNING ${sql.unsafe(TASK_COLUMNS.replaceAll('t.', ''))}
    `
    return rows[0] ? normalise(rows[0]) : null
  }

  /** Move a task and compute its sparse rank in one serialised transaction. */
  async move(id: string, status: TaskStatus, beforeId: string | null, afterId: string | null): Promise<TaskRow | null> {
    const sql = this.sql
    return sql.begin(async (tx) => {
      const currentRows = await tx<TaskRow[]>`SELECT ${tx.unsafe(TASK_COLUMNS)} FROM tasks t WHERE t.id = ${id} FOR UPDATE`
      const current = currentRows[0] ? normalise(currentRows[0]) : null
      if (!current) return null
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`task-board:${current.projectId}:${status}`}, 0))`

      const neighbour = async (taskId: string | null): Promise<TaskRow | null> => {
        if (!taskId) return null
        const rows = await tx<TaskRow[]>`SELECT ${tx.unsafe(TASK_COLUMNS)} FROM tasks t WHERE t.id = ${taskId} FOR UPDATE`
        const row = rows[0] ? normalise(rows[0]) : null
        if (!row || row.projectId !== current.projectId || row.status !== status || row.id === id) {
          throw new Error(`invalid move neighbour '${taskId}'`)
        }
        return row
      }

      let before = await neighbour(beforeId)
      let after = await neighbour(afterId)
      const appendRank = async () => {
        const rows = await tx<Array<{ rank: string }>>`
          SELECT COALESCE(max(position), 0)::text AS rank FROM tasks
          WHERE project_id = ${current.projectId} AND status = ${status} AND id <> ${id}
        `
        return Number(rows[0]?.rank ?? 0) + 1024
      }
      let position = before && after
        ? Math.floor((before.position + after.position) / 2)
        : before ? before.position + 1024
          : after ? Math.max(0, after.position - 1024)
            : await appendRank()

      if ((before && after && position <= before.position) || (after && position >= after.position)) {
        const rows = await tx<Array<{ id: string }>>`
          SELECT id::text AS id FROM tasks
          WHERE project_id = ${current.projectId} AND status = ${status} AND id <> ${id}
          ORDER BY position, id FOR UPDATE
        `
        for (let index = 0; index < rows.length; index += 1) {
          await tx`UPDATE tasks SET position = ${(index + 1) * 1024} WHERE id = ${rows[index]!.id}`
        }
        before = beforeId ? await neighbour(beforeId) : null
        after = afterId ? await neighbour(afterId) : null
        position = before && after
          ? Math.floor((before.position + after.position) / 2)
          : before ? before.position + 1024
            : after ? Math.max(0, after.position - 1024)
              : 1024
      }

      const moved = await tx<TaskRow[]>`
        UPDATE tasks SET status = ${status}, position = ${position},
          closed_at = CASE WHEN ${status} = 'done' THEN COALESCE(closed_at, now()) ELSE NULL END,
          updated_at = now()
        WHERE id = ${id}
        RETURNING ${tx.unsafe(TASK_COLUMNS.replaceAll('t.', ''))}
      `
      return moved[0] ? normalise(moved[0]) : null
    })
  }

  async remove(id: string): Promise<boolean> {
    const rows = await this.sql`DELETE FROM tasks WHERE id = ${id} RETURNING id`
    return rows.length > 0
  }

  async countByProject(): Promise<Map<string, { open: number; inProgress: number; blocked: number; review: number; done: number }>> {
    const rows = await this.sql<Array<{ projectId: string; status: TaskStatus; count: string }>>`
      SELECT project_id::text AS "projectId", status AS "status", count(*)::text AS "count"
      FROM tasks WHERE draft = false GROUP BY project_id, status
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

  async findBySourceKey(projectId: string, sourceKey: string): Promise<TaskRow | null> {
    const sql = this.sql
    const rows = await sql<TaskRow[]>`
      SELECT ${sql.unsafe(TASK_COLUMNS)} FROM tasks t
      WHERE t.project_id = ${projectId} AND t.source_key = ${sourceKey}
    `
    return rows[0] ? normalise(rows[0]) : null
  }

  async findIntactDraft(filter: { projectId: string; createdBy: string | null; parentId: string | null }): Promise<TaskRow | null> {
    const matches = await this.list({
      projectId: filter.projectId,
      createdBy: filter.createdBy,
      parentId: filter.parentId,
      draft: true,
      limit: 20,
    })
    return matches.find((row) => isIntactDraft(row)) ?? null
  }

  async sweepIntactDrafts(projectId: string, olderThan: Date): Promise<number> {
    const rows = await this.list({ projectId, draft: true, limit: 200 })
    let removed = 0
    for (const row of rows) {
      if (row.updatedAt < olderThan && isIntactDraft(row)) {
        if (await this.remove(row.id)) removed += 1
      }
    }
    return removed
  }

  async listNotes(taskId: string): Promise<TaskNoteRow[]> {
    return this.sql<TaskNoteRow[]>`
      SELECT id::text AS "id", task_id::text AS "taskId", actor AS "actor", actor_kind AS "actorKind",
             body AS "body", source_key AS "sourceKey", created_at AS "createdAt", updated_at AS "updatedAt",
             github_comment_id AS "githubCommentId", github_html_url AS "githubHtmlUrl",
             publish_state AS "publishState", publish_error AS "publishError"
      FROM task_notes WHERE task_id = ${taskId} ORDER BY created_at, id
    `
  }

  async findNote(taskId: string, noteId: string): Promise<TaskNoteRow | null> {
    const rows = await this.sql<TaskNoteRow[]>`
      SELECT id::text AS "id", task_id::text AS "taskId", actor AS "actor", actor_kind AS "actorKind",
             body AS "body", source_key AS "sourceKey", created_at AS "createdAt", updated_at AS "updatedAt",
             github_comment_id AS "githubCommentId", github_html_url AS "githubHtmlUrl",
             publish_state AS "publishState", publish_error AS "publishError"
      FROM task_notes WHERE task_id = ${taskId} AND id = ${noteId}
    `
    return rows[0] ?? null
  }

  async findNoteBySourceKey(taskId: string, sourceKey: string): Promise<TaskNoteRow | null> {
    const rows = await this.sql<TaskNoteRow[]>`
      SELECT id::text AS "id", task_id::text AS "taskId", actor AS "actor", actor_kind AS "actorKind",
             body AS "body", source_key AS "sourceKey", created_at AS "createdAt", updated_at AS "updatedAt",
             github_comment_id AS "githubCommentId", github_html_url AS "githubHtmlUrl",
             publish_state AS "publishState", publish_error AS "publishError"
      FROM task_notes WHERE task_id = ${taskId} AND source_key = ${sourceKey}
    `
    return rows[0] ?? null
  }

  async addNote(taskId: string, body: string, actor: string | null, actorKind: 'human' | 'agent' | 'system', sourceKey: string | null = null): Promise<TaskNoteRow> {
    const text = z.string().min(1).max(65536).parse(body)
    const rows = await this.sql<TaskNoteRow[]>`
      INSERT INTO task_notes (task_id, actor, actor_kind, body, source_key) VALUES (${taskId}, ${actor}, ${actorKind}, ${text}, ${sourceKey})
      RETURNING id::text AS "id", task_id::text AS "taskId", actor AS "actor", actor_kind AS "actorKind",
                body AS "body", source_key AS "sourceKey", created_at AS "createdAt", updated_at AS "updatedAt",
                github_comment_id AS "githubCommentId", github_html_url AS "githubHtmlUrl",
                publish_state AS "publishState", publish_error AS "publishError"
    `
    await this.sql`UPDATE tasks SET updated_at = now() WHERE id = ${taskId}`
    return rows[0]!
  }

  async updateNote(taskId: string, noteId: string, body: string): Promise<TaskNoteRow | null> {
    const text = z.string().min(1).max(65536).parse(body)
    const rows = await this.sql<TaskNoteRow[]>`
      UPDATE task_notes SET body = ${text}, updated_at = now()
      WHERE task_id = ${taskId} AND id = ${noteId}
      RETURNING id::text AS "id", task_id::text AS "taskId", actor AS "actor", actor_kind AS "actorKind",
             body AS "body", source_key AS "sourceKey", created_at AS "createdAt", updated_at AS "updatedAt",
             github_comment_id AS "githubCommentId", github_html_url AS "githubHtmlUrl",
             publish_state AS "publishState", publish_error AS "publishError"
    `
    if (rows[0]) await this.sql`UPDATE tasks SET updated_at = now() WHERE id = ${taskId}`
    return rows[0] ?? null
  }

  async removeNote(taskId: string, noteId: string): Promise<boolean> {
    const rows = await this.sql`DELETE FROM task_notes WHERE task_id = ${taskId} AND id = ${noteId} RETURNING id`
    return rows.length > 0
  }

  async setNotePublication(taskId: string, noteId: string, detail: {
    state: 'pending' | 'synced' | 'error'
    githubCommentId?: number | null
    githubHtmlUrl?: string | null
    error?: string | null
  }): Promise<TaskNoteRow | null> {
    const rows = await this.sql<TaskNoteRow[]>`
      UPDATE task_notes SET publish_state = ${detail.state},
        github_comment_id = ${detail.githubCommentId ?? null}, github_html_url = ${detail.githubHtmlUrl ?? null},
        publish_error = ${detail.error ?? null}
      WHERE task_id = ${taskId} AND id = ${noteId}
      RETURNING id::text AS "id", task_id::text AS "taskId", actor AS "actor", actor_kind AS "actorKind",
        body AS "body", source_key AS "sourceKey", created_at AS "createdAt", updated_at AS "updatedAt",
        github_comment_id AS "githubCommentId", github_html_url AS "githubHtmlUrl",
        publish_state AS "publishState", publish_error AS "publishError"
    `
    return rows[0] ?? null
  }

  // --- GitHub binding ------------------------------------------------------

  async listAttachments(taskId: string): Promise<TaskAttachmentRow[]> {
    return this.sql<TaskAttachmentRow[]>`
      SELECT ${this.sql.unsafe(ATTACHMENT_COLUMNS)}
      FROM task_attachments WHERE task_id = ${taskId} ORDER BY created_at DESC, id DESC
    `
  }

  async countAttachments(taskIds: string[]): Promise<Map<string, number>> {
    if (taskIds.length === 0) return new Map()
    const rows = await this.sql<Array<{ taskId: string; count: string }>>`
      SELECT task_id::text AS "taskId", count(*)::text AS "count"
      FROM task_attachments WHERE task_id = ANY(${taskIds}) GROUP BY task_id
    `
    return new Map(rows.map((row) => [row.taskId, Number(row.count)]))
  }

  async findAttachment(taskId: string, attachmentId: string): Promise<TaskAttachmentRow | null> {
    const rows = await this.sql<TaskAttachmentRow[]>`
      SELECT ${this.sql.unsafe(ATTACHMENT_COLUMNS)}
      FROM task_attachments WHERE task_id = ${taskId} AND id = ${attachmentId}
    `
    return rows[0] ?? null
  }

  /** The bytes, asked for on their own, only when something is about to serve them. */
  async readAttachment(taskId: string, attachmentId: string): Promise<{ row: TaskAttachmentRow; content: Buffer } | null> {
    const rows = await this.sql<Array<TaskAttachmentRow & { content: Uint8Array }>>`
      SELECT ${this.sql.unsafe(ATTACHMENT_COLUMNS)}, content
      FROM task_attachments WHERE task_id = ${taskId} AND id = ${attachmentId}
    `
    const row = rows[0]
    if (!row) return null
    const { content, ...meta } = row
    return { row: meta, content: Buffer.from(content) }
  }

  async addAttachment(
    taskId: string,
    file: { filename: string; contentType: string; content: Buffer },
    actor: string | null,
    actorKind: 'human' | 'agent' | 'system',
  ): Promise<TaskAttachmentRow> {
    const rows = await this.sql<TaskAttachmentRow[]>`
      INSERT INTO task_attachments (task_id, filename, content_type, size_bytes, content, actor, actor_kind)
      VALUES (${taskId}, ${file.filename}, ${file.contentType}, ${file.content.byteLength}, ${file.content}, ${actor}, ${actorKind})
      RETURNING ${this.sql.unsafe(ATTACHMENT_COLUMNS)}
    `
    await this.sql`UPDATE tasks SET updated_at = now() WHERE id = ${taskId}`
    return rows[0]!
  }

  async removeAttachment(taskId: string, attachmentId: string): Promise<boolean> {
    const rows = await this.sql`DELETE FROM task_attachments WHERE task_id = ${taskId} AND id = ${attachmentId} RETURNING id`
    if (rows.length > 0) await this.sql`UPDATE tasks SET updated_at = now() WHERE id = ${taskId}`
    return rows.length > 0
  }

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
  return {
    ...row,
    labels: Array.isArray(row.labels) ? row.labels.map(String) : [],
    position: Number(row.position),
    draft: Boolean(row.draft),
    sourceKey: row.sourceKey ?? null,
    dueAt: row.dueAt ?? null,
  }
}
