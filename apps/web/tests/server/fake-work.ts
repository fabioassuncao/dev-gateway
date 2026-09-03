// In-memory stand-ins for the work model (tasks, sessions, activity), so the
// routes can be exercised without PostgreSQL. Behaviour, not SQL, is what the
// tests are about; the SQL is exercised against a real database elsewhere.

import { isIntactDraft } from 'portta-core'
import { CreateTask, UpdateTask, type TaskAttachmentRow, type TaskEnvironmentRow, type TaskFilter, type TaskGitHubLinkRow, type TaskNoteRow, type TaskRow, type TasksRepository } from '../../src/server/db/tasks.ts'
import { StartSession, UpdateSession, type SessionRow, type SessionsRepository } from '../../src/server/db/sessions.ts'
import type { ActivityInput, ActivityRepository, ActivityRow } from '../../src/server/db/activity.ts'

let counter = 1000
const nextId = () => String(++counter)

export interface FakeTasks extends TasksRepository {
  rows: TaskRow[]
  notes: TaskNoteRow[]
  links: TaskGitHubLinkRow[]
  environments: TaskEnvironmentRow[]
  /** compose project name → environment id, for setEnvironments */
  environmentIds: Map<string, string>
  seed(task: Partial<TaskRow> & { projectId: string; title: string }): TaskRow
}

export function fakeTasks(): FakeTasks {
  const rows: TaskRow[] = []
  const notes: TaskNoteRow[] = []
  const links: TaskGitHubLinkRow[] = []
  const attachments: TaskAttachmentRow[] = []
  const attachmentBytes = new Map<string, Buffer>()
  const environments: TaskEnvironmentRow[] = []
  const environmentIds = new Map<string, string>([['alpha', 'e1'], ['alpha-issue182', 'e2']])

  const seed: FakeTasks['seed'] = (task) => {
    const row: TaskRow = {
      id: nextId(), repositoryId: null, environmentId: null, service: null, parentId: null, description: null,
      status: 'backlog', priority: null, type: null, labels: [], assignee: null, agent: null, createdBy: null, position: 0,
      dueAt: null, sourceKey: null, draft: false,
      createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'), closedAt: null,
      ...task,
    }
    rows.push(row)
    return row
  }

  const fake = {
    rows, notes, links, environments, environmentIds, seed,
    async list(filter: TaskFilter = {}) {
      return rows.filter((row) =>
        (filter.projectId === undefined || row.projectId === filter.projectId) &&
        (filter.repositoryId === undefined || row.repositoryId === filter.repositoryId) &&
        (filter.status === undefined || filter.status.includes(row.status)) &&
        (filter.priority === undefined || (row.priority !== null && filter.priority.includes(row.priority))) &&
        (filter.assignee === undefined || row.assignee === filter.assignee) &&
        (filter.agent === undefined || row.agent === filter.agent) &&
        (filter.type === undefined || row.type === filter.type) &&
        (filter.label === undefined || row.labels.includes(filter.label)) &&
        (filter.service === undefined || row.service === filter.service) &&
        (filter.parentId === undefined || row.parentId === filter.parentId) &&
        (filter.open === undefined || (filter.open ? row.status !== 'done' : row.status === 'done')) &&
        (filter.draft === undefined || row.draft === filter.draft) &&
        (filter.createdBy === undefined || row.createdBy === filter.createdBy) &&
        (filter.sourceKey === undefined || row.sourceKey === filter.sourceKey) &&
        (filter.q === undefined || row.title.toLowerCase().includes(filter.q.toLowerCase())))
        .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
    },
    async find(id: string) { return rows.find((row) => row.id === id) ?? null },
    async findByIssue(githubIssueId: string) {
      const link = links.find((entry) => entry.githubIssueId === githubIssueId)
      return link ? rows.find((row) => row.id === link.taskId) ?? null : null
    },
    async create(projectId: string, raw: unknown, createdBy: string | null) {
      const input = CreateTask.parse(raw)
      const now = new Date()
      return seed({
        projectId, ...input, createdBy,
        createdAt: now, updatedAt: now,
        closedAt: input.status === 'done' ? now : null,
      })
    },
    async update(id: string, raw: unknown) {
      const patch = UpdateTask.parse(raw)
      const row = rows.find((entry) => entry.id === id)
      if (!row) return null
      Object.assign(row, patch, { updatedAt: new Date() })
      row.closedAt = row.status === 'done' ? (row.closedAt ?? new Date()) : null
      return row
    },
    async move(id: string, status: TaskRow['status'], beforeId: string | null, afterId: string | null) {
      const row = rows.find((entry) => entry.id === id)
      if (!row) return null
      const before = beforeId ? rows.find((entry) => entry.id === beforeId) : null
      const after = afterId ? rows.find((entry) => entry.id === afterId) : null
      row.status = status
      const column = rows.filter((entry) => entry.status === status && entry.id !== id)
      const append = Math.max(0, ...column.map((entry) => entry.position)) + 1024
      row.position = before && after ? Math.floor((before.position + after.position) / 2) : before ? before.position + 1024 : after ? Math.max(0, after.position - 1024) : append
      row.updatedAt = new Date()
      row.closedAt = status === 'done' ? (row.closedAt ?? new Date()) : null
      return row
    },
    async remove(id: string) {
      const index = rows.findIndex((row) => row.id === id)
      if (index < 0) return false
      rows.splice(index, 1)
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i]!.parentId === id) rows.splice(i, 1)
      return true
    },
    async findBySourceKey(projectId: string, sourceKey: string) {
      return rows.find((row) => row.projectId === projectId && row.sourceKey === sourceKey) ?? null
    },
    async findIntactDraft(filter: { projectId: string; createdBy: string | null; parentId: string | null }) {
      return rows.find((row) =>
        row.projectId === filter.projectId && row.createdBy === filter.createdBy && row.parentId === filter.parentId && isIntactDraft(row)) ?? null
    },
    async sweepIntactDrafts(projectId: string, olderThan: Date) {
      let removed = 0
      for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i]!
        if (row.projectId === projectId && row.updatedAt < olderThan && isIntactDraft(row)) {
          rows.splice(i, 1)
          removed += 1
        }
      }
      return removed
    },
    async countByProject() {
      const map = new Map<string, { open: number; inProgress: number; blocked: number; review: number; done: number }>()
      for (const row of rows) {
        if (row.draft) continue
        const entry = map.get(row.projectId) ?? { open: 0, inProgress: 0, blocked: 0, review: 0, done: 0 }
        if (row.status === 'done') entry.done++
        else { entry.open++; if (row.status === 'in_progress') entry.inProgress++; if (row.status === 'blocked') entry.blocked++; if (row.status === 'review') entry.review++ }
        map.set(row.projectId, entry)
      }
      return map
    },
    async listNotes(taskId: string) { return notes.filter((note) => note.taskId === taskId) },
    async findNote(taskId: string, noteId: string) { return notes.find((note) => note.taskId === taskId && note.id === noteId) ?? null },
    async findNoteBySourceKey(taskId: string, sourceKey: string) { return notes.find((note) => note.taskId === taskId && note.sourceKey === sourceKey) ?? null },
    async addNote(taskId: string, body: string, actor: string | null, actorKind: 'human' | 'agent' | 'system', sourceKey: string | null = null) {
      const note: TaskNoteRow = {
        id: nextId(), taskId, actor, actorKind, body, sourceKey, createdAt: new Date(), updatedAt: null,
        publishState: 'local', githubCommentId: null, githubHtmlUrl: null, publishError: null,
      }
      notes.push(note)
      return note
    },
    async updateNote(taskId: string, noteId: string, body: string) {
      const note = notes.find((entry) => entry.taskId === taskId && entry.id === noteId)
      if (!note) return null
      note.body = body
      note.updatedAt = new Date()
      return note
    },
    async removeNote(taskId: string, noteId: string) {
      const index = notes.findIndex((note) => note.taskId === taskId && note.id === noteId)
      if (index < 0) return false
      notes.splice(index, 1)
      return true
    },
    async setNotePublication(taskId: string, noteId: string, detail: Parameters<TasksRepository['setNotePublication']>[2]) {
      const note = notes.find((entry) => entry.taskId === taskId && entry.id === noteId)
      if (!note) return null
      note.publishState = detail.state
      note.githubCommentId = detail.githubCommentId ?? null
      note.githubHtmlUrl = detail.githubHtmlUrl ?? null
      note.publishError = detail.error ?? null
      return note
    },
    async listAttachments(taskId: string) {
      return attachments.filter((attachment) => attachment.taskId === taskId)
    },
    async countAttachments(taskIds: string[]) {
      const map = new Map<string, number>()
      for (const attachment of attachments) {
        if (!taskIds.includes(attachment.taskId)) continue
        map.set(attachment.taskId, (map.get(attachment.taskId) ?? 0) + 1)
      }
      return map
    },
    async findAttachment(taskId: string, attachmentId: string) {
      return attachments.find((entry) => entry.taskId === taskId && entry.id === attachmentId) ?? null
    },
    async readAttachment(taskId: string, attachmentId: string) {
      const row = attachments.find((entry) => entry.taskId === taskId && entry.id === attachmentId)
      if (!row) return null
      return { row, content: attachmentBytes.get(row.id) ?? Buffer.alloc(0) }
    },
    async addAttachment(
      taskId: string,
      file: { filename: string; contentType: string; content: Buffer },
      actor: string | null,
      actorKind: 'human' | 'agent' | 'system',
    ) {
      const row: TaskAttachmentRow = {
        id: nextId(), taskId, filename: file.filename, contentType: file.contentType,
        sizeBytes: file.content.byteLength, actor, actorKind, createdAt: new Date(),
      }
      attachments.push(row)
      attachmentBytes.set(row.id, file.content)
      return row
    },
    async removeAttachment(taskId: string, attachmentId: string) {
      const index = attachments.findIndex((entry) => entry.taskId === taskId && entry.id === attachmentId)
      if (index < 0) return false
      attachmentBytes.delete(attachments[index]!.id)
      attachments.splice(index, 1)
      return true
    },
    async findLink(taskId: string) { return links.find((link) => link.taskId === taskId) ?? null },
    async listLinks(taskIds?: string[]) { return taskIds ? links.filter((link) => taskIds.includes(link.taskId)) : links },
    async upsertLink(link: Parameters<TasksRepository['upsertLink']>[0]) {
      const existing = links.find((entry) => entry.taskId === link.taskId)
      const row: TaskGitHubLinkRow = {
        taskId: link.taskId, githubIssueId: link.githubIssueId, syncState: link.syncState,
        lastSyncedAt: link.lastSyncedAt ?? null, lastError: link.lastError ?? null,
        localUpdatedAt: link.localUpdatedAt ?? new Date(), remoteUpdatedAt: link.remoteUpdatedAt ?? null,
      }
      if (existing) Object.assign(existing, row)
      else links.push(row)
    },
    async setLinkState(taskId: string, state: TaskGitHubLinkRow['syncState'], detail: NonNullable<Parameters<TasksRepository['setLinkState']>[2]> = {}) {
      const link = links.find((entry) => entry.taskId === taskId)
      if (!link) return
      link.syncState = state
      link.lastError = detail.lastError ?? null
      if (detail.lastSyncedAt) link.lastSyncedAt = detail.lastSyncedAt
      if (detail.remoteUpdatedAt) link.remoteUpdatedAt = detail.remoteUpdatedAt
      if (detail.localUpdatedAt) link.localUpdatedAt = detail.localUpdatedAt
    },
    async removeLink(taskId: string) {
      const index = links.findIndex((link) => link.taskId === taskId)
      if (index < 0) return false
      links.splice(index, 1)
      return true
    },
    async listEnvironments(taskIds?: string[]) { return taskIds ? environments.filter((row) => taskIds.includes(row.taskId)) : environments },
    async setEnvironments(taskId: string, composeProjects: string[]) {
      for (let i = environments.length - 1; i >= 0; i--) {
        const row = environments[i]!
        if ((row.taskId === taskId && row.source === 'manual') || composeProjects.includes(row.composeProject)) environments.splice(i, 1)
      }
      for (const name of composeProjects) {
        environments.push({ taskId, environmentId: environmentIds.get(name) ?? name, composeProject: name, source: 'manual', branch: null, linkedAt: new Date() })
      }
    },
  } as unknown as FakeTasks
  return fake
}

export interface FakeSessions extends SessionsRepository { rows: SessionRow[] }

export function fakeSessions(): FakeSessions {
  const rows: SessionRow[] = []
  return {
    rows,
    async list(filter: Parameters<SessionsRepository['list']>[0] = {}) {
      return rows.filter((row) =>
        (filter.projectId === undefined || row.projectId === filter.projectId) &&
        (filter.taskId === undefined || row.taskId === filter.taskId) &&
        (filter.status === undefined || filter.status.includes(row.status)))
    },
    async find(id: string) { return rows.find((row) => row.id === id) ?? null },
    async start(projectId: string, raw: unknown, actor: string, actorKind: 'human' | 'agent') {
      const input = StartSession.parse(raw)
      const row: SessionRow = {
        id: nextId(), projectId, taskId: input.taskId, repositoryId: input.repositoryId, environmentId: input.environmentId,
        actor: input.actor ?? actor, actorKind: input.actorKind ?? actorKind, agent: input.agent, status: 'active',
        startedAt: new Date(), lastActivityAt: new Date(), endedAt: null, summary: input.summary, headBefore: input.headBefore, headAfter: null, commits: [],
      }
      rows.push(row)
      return row
    },
    async update(id: string, raw: unknown) {
      const patch = UpdateSession.parse(raw)
      const row = rows.find((entry) => entry.id === id)
      if (!row) return null
      const status = patch.status ?? row.status
      if (row.status === 'active' && status !== 'active') row.endedAt = new Date()
      row.status = status
      if (patch.summary !== undefined) row.summary = patch.summary
      if (patch.headAfter !== undefined) row.headAfter = patch.headAfter
      if (patch.taskId !== undefined) row.taskId = patch.taskId
      if (patch.environmentId !== undefined) row.environmentId = patch.environmentId
      if (patch.repositoryId !== undefined) row.repositoryId = patch.repositoryId
      row.lastActivityAt = new Date()
      return row
    },
    async recordCommits(id: string, headAfter: string, commits: SessionRow['commits']) {
      const row = rows.find((entry) => entry.id === id)
      if (row) { row.headAfter = headAfter; row.commits = commits }
    },
    async abandonStale() { return [] },
  } as unknown as FakeSessions
}

export interface FakeActivity extends ActivityRepository { rows: ActivityRow[] }

export function fakeActivity(): FakeActivity {
  const rows: ActivityRow[] = []
  return {
    rows,
    async append(input: ActivityInput) {
      const row: ActivityRow = {
        id: nextId(), at: new Date(), kind: input.kind, actor: input.actor ?? null, actorKind: input.actorKind ?? null, source: input.source ?? null,
        projectId: input.projectId ?? null, taskId: input.taskId ?? null, repositoryId: input.repositoryId ?? null,
        environmentId: input.environmentId ?? null, sessionId: input.sessionId ?? null, summary: input.summary, data: input.data ?? {},
      }
      rows.unshift(row)
      return row
    },
    async list(filter: Parameters<ActivityRepository['list']>[0] = {}) {
      return rows.filter((row) =>
        (filter.projectId === undefined || row.projectId === filter.projectId) &&
        (filter.taskId === undefined || row.taskId === filter.taskId) &&
        (filter.repositoryId === undefined || row.repositoryId === filter.repositoryId) &&
        (filter.environmentId === undefined || row.environmentId === filter.environmentId) &&
        (filter.sessionId === undefined || row.sessionId === filter.sessionId) &&
        (filter.kinds === undefined || filter.kinds.includes(row.kind))).slice(0, filter.limit ?? 50)
    },
    async prune() { return 0 },
  } as unknown as FakeActivity
}
