// The task verbs, over Portta's own tasks.
//
// A task is local. It exists without GitHub; a GitHub issue is an optional
// binding on it (routes/task-github.ts). Every write here lands locally first
// and, when the task is bound and the App can be used, on GitHub second, with
// the binding saying which of the two it managed. An agent and the board see
// the same rows through the same views (core/task-view.ts).

import { Hono } from 'hono'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import { ExampleDocument, TASK_DRAFT_MAX_AGE_MS, TASK_DRAFT_TITLE, TASK_PRIORITIES, TASK_STATUSES, finishPlan, nextTask, shouldPromoteDraft, startPlan, subtaskTree, type SchedulableTask } from 'portta-core'
import type { AppDeps } from './deps.ts'
import { requireDatabase, type Database } from '../db/index.ts'
import type { TaskRow } from '../db/tasks.ts'
import { OverrideRefused } from '../core/overrides.ts'
import { loadTaskContext, taskSummaries, taskSummary, taskView, noteView, type TaskContext } from '../core/task-view.ts'
import { pushToGitHub, resolveTask, type TaskChange } from '../core/task-write.ts'
import { recordActivity } from '../core/activity.ts'
import { applyExampleDocument, exportProjectTasks } from '../core/task-example-apply.ts'
import { principalOf, type Principal } from '../principal.ts'
import { Task, TaskNote, TaskSummary } from '../../shared/task-types.ts'
import { documentRoute } from '../openapi.ts'

const TasksResponse = z.object({ tasks: z.array(TaskSummary) }).strict().meta({ ref: 'TasksResponse' })
/** `null` rather than 404: "nothing to do" is an answer, not a missing thing. */
const NextTaskResponse = z.object({ task: Task.nullable() }).strict().meta({ ref: 'NextTaskResponse' })
const SubtaskNode: z.ZodType = z.lazy(() => z.object({ task: TaskSummary, children: z.array(SubtaskNode) }).strict())
const SubtasksResponse = z.object({ subtasks: z.array(SubtaskNode) }).strict().meta({ ref: 'SubtasksResponse' })
const NotesResponse = z.object({ notes: z.array(TaskNote) }).strict().meta({ ref: 'TaskNotesResponse' })

const LocalId = z.string().regex(/^\d+$/)
const CreateTaskBody = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(65536).nullable().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).nullable().optional(),
  type: z.string().max(32).nullable().optional(),
  labels: z.array(z.string().min(1).max(64)).max(32).optional(),
  assignee: z.string().max(64).nullable().optional(),
  agent: z.string().max(64).nullable().optional(),
  parentId: LocalId.nullable().optional(),
  repositoryId: LocalId.nullable().optional(),
  environment: z.string().max(255).nullable().optional().describe('COMPOSE_PROJECT_NAME the task is scoped to'),
  service: z.string().max(64).nullable().optional(),
  dueAt: z.number().int().nullable().optional().describe('Unix timestamp in seconds'),
  draft: z.boolean().optional(),
}).strict().meta({ ref: 'CreateTaskBody' })

const PatchTaskBody = CreateTaskBody.partial().extend({
  title: z.string().min(1).max(200).optional(),
  position: z.number().int().min(0).optional(),
}).strict().meta({ ref: 'PatchTaskBody' })

const StartBody = z.object({ assign: z.boolean().optional() }).strict().meta({ ref: 'StartTaskBody' })
const StatusBody = z.object({ status: z.enum(TASK_STATUSES) }).strict().meta({ ref: 'TaskStatusBody' })
const FinishBody = z.object({ close: z.boolean().optional() }).strict().meta({ ref: 'FinishTaskBody' })
const NoteBody = z.object({ body: z.string().min(1).max(65536) }).strict().meta({ ref: 'TaskNoteBody' })
const EnvironmentsBody = z.object({ environments: z.array(z.string().min(1).max(255)).max(32) }).strict().meta({ ref: 'TaskEnvironmentsBody' })
const Removal = z.object({ ok: z.boolean(), removed: z.string(), note: z.string() }).strict().meta({ ref: 'TaskRemoval' })

export const refParameter = {
  name: 'ref', in: 'path' as const, required: true,
  description: 'The task id, `#id`, or `owner/repo#number` through its GitHub binding.',
  schema: { type: 'string' as const },
}
const slugParameter = { name: 'slug', in: 'path' as const, required: true, description: 'The Project slug.', schema: { type: 'string' as const } }
export const actorHeader = {
  name: 'X-Portta-Actor', in: 'header' as const, required: false,
  description: 'Who asked. Recorded on the task, its notes and the activity; never forwarded to GitHub.',
  schema: { type: 'string' as const },
}
const FILTERS = [
  ['status', 'Comma-separated statuses.'], ['open', 'true for anything not done, false for done only.'],
  ['assignee', 'Exact assignee.'], ['repository', 'Repository id.'], ['parent', 'Parent task id, or "none" for top-level tasks.'],
  ['q', 'Substring of the title or description.'],
  ['draft', 'true to list only drafts; omitted lists published tasks.'],
] as const
const filterParameters = FILTERS.map(([name, description]) => ({ name, in: 'query' as const, required: false, description, schema: { type: 'string' as const } }))

function seconds(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

function schedulable(rows: readonly TaskRow[]): SchedulableTask[] {
  return rows.map((row) => ({ id: row.id, parentId: row.parentId, status: row.status, priority: row.priority, assignee: row.assignee, waitingSince: seconds(row.updatedAt) }))
}

export function taskRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  async function requireProject(db: Database, slug: string) {
    const project = await db.projects.find(slug)
    if (!project) throw new HTTPException(404, { message: `no project '${slug}'` })
    return project
  }

  async function context(db: Database, tasks?: TaskRow[]): Promise<TaskContext> {
    return loadTaskContext(deps.config, db, await deps.cache.get(), tasks)
  }

  async function present(db: Database, task: TaskRow): Promise<Task> {
    const fresh = (await db.tasks.find(task.id)) ?? task
    const ctx = await context(db)
    const [notes, sessions] = await Promise.all([db.tasks.listNotes(fresh.id), db.sessions.list({ taskId: fresh.id, status: ['active'] })])
    return taskView(ctx, fresh, notes, sessions)
  }

  function announce(task: TaskRow, action: string, slug: string | null): void {
    deps.hub.publish({ kind: 'task', action, id: task.id, name: task.title, project: slug, ownership: null, at: Math.floor(Date.now() / 1000) })
  }

  async function slugOf(db: Database, task: TaskRow): Promise<string> {
    return (await db.projects.list()).find((project) => project.id === task.projectId)?.slug ?? task.projectId
  }

  async function environmentIdOf(db: Database, name: string | null | undefined): Promise<string | null | undefined> {
    if (name === undefined) return undefined
    if (name === null) return null
    const record = await db.environments.find(name)
    if (!record) throw new OverrideRefused(`no environment '${name}' is known to this panel`)
    return record.id
  }

  function dueAtOf(value: number | null | undefined): Date | null | undefined {
    if (value === undefined) return undefined
    if (value === null) return null
    return new Date(value * 1000)
  }

  async function wouldCycle(db: Database, taskId: string, parentId: string): Promise<boolean> {
    let current: string | null = parentId
    const seen = new Set<string>([taskId])
    while (current) {
      if (seen.has(current)) return true
      seen.add(current)
      const parent = await db.tasks.find(current)
      current = parent?.parentId ?? null
    }
    return false
  }

  /**
   * One local write, then GitHub when the task is bound. The activity line and
   * the live event carry the actor, so "did a person do that or an agent" has
   * an answer without inventing an identity system.
   */
  async function write(db: Database, task: TaskRow, patch: Record<string, unknown>, change: TaskChange, principal: Principal, kind: 'task.created' | 'task.updated' | 'task.status' | 'task.assigned', summary: string): Promise<Task> {
    const updated = await db.tasks.update(task.id, patch)
    if (!updated) throw new HTTPException(404, { message: `no task '${task.id}'` })
    const link = await db.tasks.findLink(task.id)
    const pushed = await pushToGitHub(db, deps.github, updated, link, change)
    const slug = await slugOf(db, updated)
    await recordActivity({ db, hub: deps.hub }, {
      kind, actor: principal.actor, actorKind: principal.actorKind, project: slug,
      projectId: updated.projectId, taskId: updated.id, repositoryId: updated.repositoryId, environmentId: updated.environmentId,
      summary, data: { github: pushed, ...change },
    })
    announce(updated, kind.split('.')[1] ?? 'updated', slug)
    return present(db, updated)
  }

  // --- reads ----------------------------------------------------------------

  app.get('/projects/:slug/tasks', documentRoute({
    tag: 'Tasks', operationId: 'listProjectTasks', capability: 'task:read',
    summary: "List a Project's tasks",
    description: 'Local tasks, with their GitHub binding where one exists. Answers without GitHub and without the App.',
    response: TasksResponse, parameters: [slugParameter, ...filterParameters], errors: [404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const project = await requireProject(db, c.req.param('slug'))
    const query = new URL(c.req.url).searchParams
    const status = query.get('status')?.split(',').filter((value): value is typeof TASK_STATUSES[number] => (TASK_STATUSES as readonly string[]).includes(value))
    const parent = query.get('parent')
    const rows = await db.tasks.list({
      projectId: project.id,
      ...(status && status.length > 0 ? { status } : {}),
      ...(query.get('open') === 'true' ? { open: true } : query.get('open') === 'false' ? { open: false } : {}),
      ...(query.get('assignee') ? { assignee: query.get('assignee')! } : {}),
      ...(query.get('repository') ? { repositoryId: query.get('repository')! } : {}),
      ...(parent === 'none' ? { parentId: null } : parent ? { parentId: parent } : {}),
      ...(query.get('q') ? { q: query.get('q')! } : {}),
      draft: query.get('draft') === 'true' ? true : query.get('draft') === 'false' ? false : false,
    })
    const ctx = await context(db)
    return c.json({ tasks: taskSummaries(ctx, rows) })
  })

  app.get('/projects/:slug/tasks/next', documentRoute({
    tag: 'Tasks', operationId: 'nextTask', capability: 'task:read',
    summary: 'The task to do next, or null',
    description: 'Ready, unblocked by its subtasks, unassigned or assigned to the caller; then by priority, then by how long it has waited.',
    response: NextTaskResponse, parameters: [slugParameter, actorHeader], errors: [404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const project = await requireProject(db, c.req.param('slug'))
    const rows = await db.tasks.list({ projectId: project.id, open: true, draft: false })
    const chosen = nextTask(schedulable(rows), { actor: principalOf(c).actor })
    const row = chosen ? rows.find((task) => task.id === chosen.id) ?? null : null
    return c.json({ task: row ? await present(db, row) : null })
  })

  app.get('/tasks/:ref', documentRoute({
    tag: 'Tasks', operationId: 'getTask', capability: 'task:read', summary: 'Get one task',
    description: 'With its binding, environments, notes and subtasks. Addressable by id, `#id`, or `owner/repo#number`.',
    response: Task, parameters: [refParameter], errors: [400, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    return c.json(await present(db, await resolveTask(db, c.req.param('ref'))))
  })

  app.get('/tasks/:ref/subtasks', documentRoute({
    tag: 'Tasks', operationId: 'getSubtasks', capability: 'task:read', summary: 'The subtask tree under one task',
    response: SubtasksResponse, parameters: [refParameter], errors: [400, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const task = await resolveTask(db, c.req.param('ref'))
    const rows = await db.tasks.list({ projectId: task.projectId })
    const ctx = await context(db, rows)
    const tree = subtaskTree(task.id, rows)
    const render = (nodes: typeof tree): unknown[] => nodes.map((node) => ({ task: taskSummary(ctx, node.task), children: render(node.children) }))
    return c.json({ subtasks: render(tree) })
  })

  app.get('/tasks/:ref/notes', documentRoute({
    tag: 'Tasks', operationId: 'listTaskNotes', capability: 'task:read', summary: 'The notes on a task, oldest first',
    response: NotesResponse, parameters: [refParameter], errors: [400, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const task = await resolveTask(db, c.req.param('ref'))
    return c.json({ notes: (await db.tasks.listNotes(task.id)).map(noteView) })
  })

  // --- writes ---------------------------------------------------------------

  app.post('/projects/:slug/tasks', documentRoute({
    tag: 'Tasks', operationId: 'createTask', capability: 'task:write', summary: 'Create a task',
    description: 'Local, immediately. Bind it to a GitHub issue afterwards with /github/link or /github/publish.',
    request: CreateTaskBody, response: Task, status: 201, parameters: [slugParameter, actorHeader],
    errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const project = await requireProject(db, c.req.param('slug'))
    const body = CreateTaskBody.parse(await c.req.json())
    const principal = principalOf(c)
    const { environment, dueAt, ...rest } = body
    if (rest.parentId) {
      const parent = await db.tasks.find(rest.parentId)
      if (!parent || parent.projectId !== project.id) throw new OverrideRefused('a subtask belongs to the same Project as its parent')
    }
    if (rest.repositoryId) {
      const repository = await db.repositories.find(rest.repositoryId)
      if (!repository || repository.projectId !== project.id) throw new OverrideRefused('that repository does not belong to this Project')
    }
    const environmentId = await environmentIdOf(db, environment)
    if (rest.draft) {
      await db.tasks.sweepIntactDrafts(project.id, new Date(Date.now() - TASK_DRAFT_MAX_AGE_MS))
      const reused = await db.tasks.findIntactDraft({ projectId: project.id, createdBy: principal.actor, parentId: rest.parentId ?? null })
      if (reused) return c.json(await present(db, reused), 200)
    }
    const created = await db.tasks.create(project.id, {
      ...rest,
      title: rest.title || TASK_DRAFT_TITLE,
      ...(environmentId !== undefined ? { environmentId } : {}),
      ...(dueAt !== undefined ? { dueAt: dueAtOf(dueAt) } : {}),
    }, principal.actor)
    if (!created.draft) {
      await recordActivity({ db, hub: deps.hub }, {
        kind: 'task.created', actor: principal.actor, actorKind: principal.actorKind, project: project.slug,
        projectId: project.id, taskId: created.id, repositoryId: created.repositoryId, environmentId: created.environmentId,
        summary: `${principal.actor ?? 'somebody'} created "${created.title}"`,
      })
      announce(created, 'created', project.slug)
    }
    return c.json(await present(db, created), 201)
  })

  app.patch('/tasks/:ref', documentRoute({
    tag: 'Tasks', operationId: 'patchTask', capability: 'task:write', summary: 'Change a task',
    description: 'Written locally first. On a bound task, title, description, status, priority and assignee are also written to GitHub; the binding says whether that reached it.',
    request: PatchTaskBody, response: Task, parameters: [refParameter, actorHeader], errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const task = await resolveTask(db, c.req.param('ref'))
    const body = PatchTaskBody.parse(await c.req.json())
    if (Object.keys(body).length === 0) throw new OverrideRefused('nothing to change')
    const { environment, dueAt, ...rest } = body
    if (rest.parentId) {
      if (rest.parentId === task.id) throw new OverrideRefused('a task cannot be its own parent')
      const parent = await db.tasks.find(rest.parentId)
      if (!parent || parent.projectId !== task.projectId) throw new OverrideRefused('a subtask belongs to the same Project as its parent')
      if (await wouldCycle(db, task.id, rest.parentId)) throw new OverrideRefused('a task cannot become a descendant of itself')
    }
    if (rest.repositoryId) {
      const repository = await db.repositories.find(rest.repositoryId)
      if (!repository || repository.projectId !== task.projectId) throw new OverrideRefused('that repository does not belong to this Project')
    }
    const environmentId = await environmentIdOf(db, environment)
    const patch: Record<string, unknown> = { ...rest, ...(environmentId !== undefined ? { environmentId } : {}), ...(dueAt !== undefined ? { dueAt: dueAtOf(dueAt) } : {}) }
    if (task.draft && shouldPromoteDraft({
      draft: task.draft, title: task.title, description: task.description, status: task.status,
      priority: task.priority, type: task.type, labels: task.labels, assignee: task.assignee,
      agent: task.agent, service: task.service, dueAt: task.dueAt,
    }, {
      ...(rest.title !== undefined ? { title: rest.title } : {}),
      ...(rest.description !== undefined ? { description: rest.description } : {}),
      ...(rest.status !== undefined ? { status: rest.status } : {}),
      ...(rest.priority !== undefined ? { priority: rest.priority } : {}),
      ...(rest.type !== undefined ? { type: rest.type } : {}),
      ...(rest.labels !== undefined ? { labels: rest.labels } : {}),
      ...(rest.assignee !== undefined ? { assignee: rest.assignee } : {}),
      ...(rest.agent !== undefined ? { agent: rest.agent } : {}),
      ...(rest.service !== undefined ? { service: rest.service } : {}),
      ...(dueAt !== undefined ? { dueAt: dueAtOf(dueAt) } : {}),
      ...(rest.draft !== undefined ? { draft: rest.draft } : {}),
    })) {
      patch.draft = false
    }
    const change: TaskChange = {
      ...(rest.title !== undefined ? { title: rest.title } : {}),
      ...(rest.description !== undefined ? { description: rest.description } : {}),
      ...(rest.status !== undefined ? { status: rest.status } : {}),
      ...(rest.priority !== undefined ? { priority: rest.priority } : {}),
      ...(rest.assignee !== undefined ? { assignee: rest.assignee } : {}),
      ...(rest.status === 'done' ? { close: true } : {}),
    }
    const principal = principalOf(c)
    const kind = patch.draft === false && task.draft
      ? 'task.created'
      : rest.status !== undefined && rest.status !== task.status ? 'task.status' : rest.assignee !== undefined ? 'task.assigned' : 'task.updated'
    const summary = kind === 'task.created'
      ? `${principalOf(c).actor ?? 'somebody'} created "${rest.title ?? task.title}"`
      : kind === 'task.status' ? `"${task.title}" moved to ${rest.status}` : kind === 'task.assigned' ? `"${task.title}" assigned to ${rest.assignee ?? 'nobody'}` : `"${task.title}" was edited`
    return c.json(await write(db, task, patch, change, principal, kind, summary))
  })

  app.delete('/tasks/:ref', documentRoute({
    tag: 'Tasks', operationId: 'deleteTask', capability: 'task:write', summary: 'Delete a task and its subtasks',
    description: 'Local only: a bound GitHub issue is left as it is, unbound.',
    response: Removal, parameters: [refParameter, actorHeader], errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const task = await resolveTask(db, c.req.param('ref'))
    const slug = await slugOf(db, task)
    const principal = principalOf(c)
    await db.tasks.remove(task.id)
    await recordActivity({ db, hub: deps.hub }, {
      kind: 'task.deleted', actor: principal.actor, actorKind: principal.actorKind, project: slug,
      projectId: task.projectId, repositoryId: task.repositoryId, summary: `"${task.title}" was deleted`, data: { taskId: task.id },
    })
    announce(task, 'deleted', slug)
    return c.json({ ok: true, removed: task.id, note: 'the task and its subtasks; a bound GitHub issue is untouched' })
  })

  app.post('/tasks/:ref/start', documentRoute({
    tag: 'Tasks', operationId: 'startTask', capability: 'task:write', summary: 'Take a task',
    description: 'Sets the status to in_progress and, unless assign is false, assigns the actor — in one write, so a task is never half-taken.',
    request: StartBody, response: Task, parameters: [refParameter, actorHeader], errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const task = await resolveTask(db, c.req.param('ref'))
    const body = StartBody.parse(await c.req.json().catch(() => ({})))
    const principal = principalOf(c)
    const plan = startPlan(task, body.assign === false ? null : principal.actor)
    const patch: Record<string, unknown> = { status: plan.status, ...(plan.assignee ? { assignee: plan.assignee } : {}), ...(principal.kind === 'agent' && plan.assignee ? { agent: principal.actor } : {}), ...(task.draft ? { draft: false } : {}) }
    return c.json(await write(db, task, patch, { status: plan.status, ...(plan.assignee ? { assignee: plan.assignee } : {}) }, principal, 'task.status', `${principal.actor ?? 'somebody'} started "${task.title}"`))
  })

  app.post('/tasks/:ref/status', documentRoute({
    tag: 'Tasks', operationId: 'setTaskStatus', capability: 'task:write', summary: 'Move a task to one status',
    request: StatusBody, response: Task, parameters: [refParameter, actorHeader], errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const task = await resolveTask(db, c.req.param('ref'))
    const body = StatusBody.parse(await c.req.json())
    const principal = principalOf(c)
    return c.json(await write(db, task, { status: body.status, ...(task.draft ? { draft: false } : {}) }, { status: body.status, ...(body.status === 'done' ? { close: true } : {}) }, principal, 'task.status', `"${task.title}" moved to ${body.status}`))
  })

  app.post('/tasks/:ref/finish', documentRoute({
    tag: 'Tasks', operationId: 'finishTask', capability: 'task:write', summary: 'Finish a task',
    description: 'Sets the status to done. On a bound task, close: true also closes the issue on GitHub.',
    request: FinishBody, response: Task, parameters: [refParameter, actorHeader], errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const task = await resolveTask(db, c.req.param('ref'))
    const body = FinishBody.parse(await c.req.json().catch(() => ({})))
    const plan = finishPlan(body.close === true)
    const principal = principalOf(c)
    return c.json(await write(db, task, { status: plan.status, ...(task.draft ? { draft: false } : {}) }, { status: plan.status, close: plan.close }, principal, 'task.status', `${principal.actor ?? 'somebody'} finished "${task.title}"`))
  })

  app.post('/tasks/:ref/notes', documentRoute({
    tag: 'Tasks', operationId: 'addTaskNote', capability: 'task:write', summary: 'Add a note to a task',
    description: 'Local. A note never reaches GitHub; a comment on the bound issue is /comments.',
    request: NoteBody, response: TaskNote, status: 201, parameters: [refParameter, actorHeader], errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const task = await resolveTask(db, c.req.param('ref'))
    const body = NoteBody.parse(await c.req.json())
    const principal = principalOf(c)
    const note = await db.tasks.addNote(task.id, body.body, principal.actor, principal.actorKind)
    if (task.draft) await db.tasks.update(task.id, { draft: false })
    const slug = await slugOf(db, task)
    await recordActivity({ db, hub: deps.hub }, {
      kind: 'task.note', actor: principal.actor, actorKind: principal.actorKind, project: slug,
      projectId: task.projectId, taskId: task.id, repositoryId: task.repositoryId,
      summary: `${principal.actor ?? 'somebody'} noted on "${task.title}"`, data: { noteId: note.id },
    })
    announce(task, 'note', slug)
    return c.json(noteView(note), 201)
  })

  app.patch('/tasks/:ref/notes/:noteId', documentRoute({
    tag: 'Tasks', operationId: 'updateTaskNote', capability: 'task:write', summary: 'Edit a local note',
    request: NoteBody, response: TaskNote, parameters: [refParameter, { name: 'noteId', in: 'path' as const, required: true, schema: { type: 'string' as const } }, actorHeader],
    errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const task = await resolveTask(db, c.req.param('ref'))
    const existing = await db.tasks.findNote(task.id, c.req.param('noteId'))
    if (!existing) throw new HTTPException(404, { message: `no note '${c.req.param('noteId')}'` })
    const principal = principalOf(c)
    if (existing.actor && principal.actor && existing.actor !== principal.actor && principal.kind !== 'operator') {
      throw new OverrideRefused('only the author can edit this note')
    }
    const body = NoteBody.parse(await c.req.json())
    const updated = await db.tasks.updateNote(task.id, existing.id, body.body)
    if (!updated) throw new HTTPException(404, { message: `no note '${existing.id}'` })
    return c.json(noteView(updated))
  })

  app.delete('/tasks/:ref/notes/:noteId', documentRoute({
    tag: 'Tasks', operationId: 'deleteTaskNote', capability: 'task:write', summary: 'Delete a local note',
    response: z.object({ ok: z.boolean(), removed: z.string() }).strict(),
    parameters: [refParameter, { name: 'noteId', in: 'path' as const, required: true, schema: { type: 'string' as const } }, actorHeader],
    errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const task = await resolveTask(db, c.req.param('ref'))
    const existing = await db.tasks.findNote(task.id, c.req.param('noteId'))
    if (!existing) throw new HTTPException(404, { message: `no note '${c.req.param('noteId')}'` })
    const principal = principalOf(c)
    if (existing.actor && principal.actor && existing.actor !== principal.actor && principal.kind !== 'operator') {
      throw new OverrideRefused('only the author can delete this note')
    }
    await db.tasks.removeNote(task.id, existing.id)
    return c.json({ ok: true, removed: existing.id })
  })

  app.post('/projects/:slug/tasks/import', documentRoute({
    tag: 'Tasks', operationId: 'importProjectTasks', capability: 'task:write',
    summary: 'Import a versioned task document',
    description: 'Reconciles by source_key. Repository, environment and parent are names, never database ids.',
    request: ExampleDocument, response: z.object({ project: z.string(), created: z.number(), updated: z.number(), tasks: z.array(Task) }).strict(),
    parameters: [slugParameter, actorHeader], errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const applied = await applyExampleDocument(db, deps.config, await deps.cache.get(), c.req.param('slug'), await c.req.json())
    return c.json(applied)
  })

  app.get('/projects/:slug/tasks/export', documentRoute({
    tag: 'Tasks', operationId: 'exportProjectTasks', capability: 'task:read',
    summary: 'Export the project tasks as a versioned document',
    response: ExampleDocument, parameters: [slugParameter], errors: [404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    return c.json(await exportProjectTasks(db, deps.config, await deps.cache.get(), c.req.param('slug')))
  })

  /**
   * Links a task to the environments it is being worked in, by hand. Writes
   * one row per link; nothing is started, stopped, created or removed, and a
   * manual link always wins over an inferred one.
   */
  app.put('/tasks/:ref/environments', documentRoute({
    tag: 'Tasks', operationId: 'setTaskEnvironments', capability: 'task:write',
    summary: 'Link a task to the environments it is worked in',
    request: EnvironmentsBody, response: Task, parameters: [refParameter, actorHeader], errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const task = await resolveTask(db, c.req.param('ref'))
    const body = EnvironmentsBody.parse(await c.req.json())
    const snapshot = await deps.cache.get()
    // An environment adopted by another Project is that Project's: linking a
    // task across that line would make "what is this running for" answer
    // with somebody else's work.
    const adopted = new Map((await db.projects.listEnvironments()).map((row) => [row.composeProject, row.projectId]))
    for (const name of body.environments) {
      if (!snapshot.environments.some((environment) => environment.name === name)) throw new OverrideRefused(`no environment '${name}' is running`)
      const owner = adopted.get(name)
      if (owner !== undefined && owner !== task.projectId) throw new OverrideRefused(`environment '${name}' belongs to another Project`)
    }
    await db.tasks.setEnvironments(task.id, body.environments)
    const principal = principalOf(c)
    const slug = await slugOf(db, task)
    await recordActivity({ db, hub: deps.hub }, {
      kind: 'task.linked', actor: principal.actor, actorKind: principal.actorKind, project: slug,
      projectId: task.projectId, taskId: task.id, summary: `"${task.title}" linked to ${body.environments.join(', ') || 'no environment'}`,
      data: { environments: body.environments },
    })
    announce(task, 'linked', slug)
    return c.json(await present(db, task))
  })

  return app
}
