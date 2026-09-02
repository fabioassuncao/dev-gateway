// The task verbs: the same projection and the same adapter, asked the way an
// agent asks.
//
// Nothing here reaches GitHub in a way `PATCH /api/issues/:id` does not already:
// a write goes to GitHub first and the projection is updated from what GitHub
// returned, the repository projection is still the authorisation boundary, and
// read-only mode still refuses. What is new is the vocabulary — next, start,
// status, finish, comment — and one behaviour: a comment, written through and
// never projected.

import { Hono } from 'hono'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import type { AppDeps } from './deps.ts'
import { requireDatabase, type Database } from '../db/index.ts'
import type { StoredIssue } from '../db/github.ts'
import { OverrideRefused } from '../core/overrides.ts'
import { labelsAfter, WORKFLOW_STATUSES, type WorkflowStatus } from '../integrations/github/metadata.ts'
import { normaliseIssue, type RawIssue } from '../integrations/github/issues.ts'
import {
  finishPlan,
  nextTask,
  parseTaskRef,
  readActor,
  startPlan,
  subtaskTree,
  type SubtaskNode,
  type TransitionPlan,
} from '../core/tasks.ts'
import { issueViews } from '../core/issue-view.ts'
import { Issue } from '../../shared/types.ts'
import { documentRoute } from '../openapi.ts'

const TasksResponse = z.object({ tasks: z.array(Issue) }).strict().meta({ ref: 'TasksResponse' })

/** `null` rather than 404: "nothing to do" is an answer, not a missing thing. */
const NextTaskResponse = z.object({ task: Issue.nullable() }).strict().meta({ ref: 'NextTaskResponse' })

const SubtaskNode: z.ZodType = z.lazy(() =>
  z.object({ task: Issue, children: z.array(SubtaskNode) }).strict(),
)
const SubtasksResponse = z.object({ subtasks: z.array(SubtaskNode) }).strict().meta({ ref: 'SubtasksResponse' })

const StartBody = z.object({ assign: z.boolean().optional() }).strict().meta({ ref: 'StartTaskBody' })
const StatusBody = z.object({ status: z.enum(WORKFLOW_STATUSES) }).strict().meta({ ref: 'TaskStatusBody' })
const FinishBody = z.object({ close: z.boolean().optional() }).strict().meta({ ref: 'FinishTaskBody' })
const CommentBody = z.object({ body: z.string().min(1).max(65536) }).strict().meta({ ref: 'TaskCommentBody' })

/**
 * A comment is returned as GitHub returned it, because nothing stores it.
 * Normalising would imply a shape Portta owns, and Portta owns no comment.
 */
const CommentResponse = z
  .object({ id: z.number(), htmlUrl: z.string(), body: z.string(), createdAt: z.string() })
  .strict()
  .meta({ ref: 'TaskCommentResponse' })

const refParameter = {
  name: 'ref',
  in: 'path' as const,
  required: true,
  description: 'Either `owner/repo#number` (URL-encoded) or the projected task id.',
  schema: { type: 'string' as const },
}

const slugParameter = {
  name: 'slug',
  in: 'path' as const,
  required: true,
  description: 'The workspace slug.',
  schema: { type: 'string' as const },
}

const actorHeader = {
  name: 'X-Portta-Actor',
  in: 'header' as const,
  required: false,
  description: 'Who asked. Recorded in the panel log and never forwarded to GitHub.',
  schema: { type: 'string' as const },
}

export function taskRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  /** Repositories one workspace owns, as projection ids. */
  async function workspaceRepositoryIds(db: Database, slug: string): Promise<string[]> {
    const workspace = await db.workspaces.find(slug)
    if (!workspace) throw new HTTPException(404, { message: `no workspace '${slug}'` })
    const links = await db.workspaces.listRepositories()
    return links.filter((link) => link.workspaceId === workspace.id).map((link) => link.repositoryId)
  }

  /**
   * Resolve a ref through the projection.
   *
   * This is the authorisation boundary: a coordinate for a repository the
   * installation never granted is not in the projection, so it is refused here
   * — before any request leaves the host.
   */
  async function resolve(db: Database, raw: string): Promise<StoredIssue> {
    const ref = parseTaskRef(raw)
    if (!ref) throw new HTTPException(400, { message: `'${raw}' is not a task reference` })
    if (ref.kind === 'id') {
      const issue = await db.github.findIssue(ref.id)
      if (!issue) throw new HTTPException(404, { message: `no task '${raw}'` })
      return issue
    }
    const issues = await db.github.listIssues({})
    const found = issues.find((issue) => issue.repository === ref.repository && issue.number === ref.number)
    if (!found) {
      throw new HTTPException(404, {
        message: `no task '${ref.repository}#${ref.number}' in the projection`,
      })
    }
    return found
  }

  /**
   * One task, assembled the way the board assembles an issue.
   *
   * Through the shared `issueViews`, so an agent and the board cannot see
   * different staleness, metadata sources or environments for the same row.
   */
  async function present(db: Database, issue: StoredIssue): Promise<Issue> {
    const fresh = (await db.github.findIssue(issue.id)) ?? issue
    const snapshot = await deps.cache.get()
    const [view] = await issueViews(deps.config, db, snapshot, [fresh], await db.github.listIssues({}))
    if (!view) throw new HTTPException(404, { message: `no task '${issue.id}'` })
    return view
  }

  async function presentAll(db: Database, issues: StoredIssue[]): Promise<Issue[]> {
    if (issues.length === 0) return []
    const snapshot = await deps.cache.get()
    return issueViews(deps.config, db, snapshot, issues, await db.github.listIssues({}))
  }

  function requireGitHub() {
    const github = deps.github
    if (github === null || !github.status().configured) {
      throw new OverrideRefused(
        'the GitHub App is not configured, so nothing can be written back',
        'see docs/github.md',
      )
    }
    return github
  }

  /**
   * One confirmed write, then the projection from GitHub's answer.
   *
   * Every task verb that changes something goes through here, so `start`,
   * `status` and `finish` cannot drift from `PATCH /api/issues/:id` in what
   * they refuse or in where the truth comes from.
   */
  async function transition(db: Database, issue: StoredIssue, plan: TransitionPlan, actor: string | null) {
    const github = requireGitHub()
    const repository = await db.github.findRepository(issue.repository)
    if (!repository) {
      throw new OverrideRefused(`${issue.repository} is not a repository this gateway was granted`)
    }

    const patch: Record<string, unknown> = {
      labels: labelsAfter(issue.labels, { status: plan.status }),
    }
    if (plan.state) patch['state'] = plan.state
    if (plan.assignees) patch['assignees'] = plan.assignees

    const updated = await github.require().patchAsInstallation<RawIssue>(
      repository.installationId,
      `/repos/${issue.repository}/issues/${issue.number}`,
      patch,
    )
    await db.github.upsertIssue(normaliseIssue(updated.data, issue.repositoryId))

    // Recorded here and nowhere else: GitHub sees the App, so this is the only
    // place that can answer "did a person do that, or an agent".
    process.stdout.write(
      `task ${issue.repository}#${issue.number} -> ${plan.status}${actor ? ` by ${actor}` : ''}\n`,
    )
    deps.hub.publish({
      kind: 'config', action: 'issue', id: issue.id,
      name: `${issue.repository}#${issue.number}`,
      project: null, ownership: null, at: Math.floor(Date.now() / 1000),
    })
    return present(db, issue)
  }

  // --- reads: projection only, no network ----------------------------------

  app.get('/workspaces/:slug/tasks', documentRoute({
    tag: 'Tasks', operationId: 'listWorkspaceTasks',
    summary: "List a workspace's tasks",
    description: 'A view over the projection. Answers while GitHub is unreachable; every row carries syncedAt and a staleness flag.',
    response: TasksResponse, parameters: [slugParameter], errors: [404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const repositoryIds = await workspaceRepositoryIds(db, c.req.param('slug'))
    if (repositoryIds.length === 0) return c.json({ tasks: [] })
    return c.json({ tasks: await presentAll(db, await db.github.listIssues({ repositoryIds })) })
  })

  app.get('/workspaces/:slug/tasks/next', documentRoute({
    tag: 'Tasks', operationId: 'nextTask',
    summary: 'The task to do next, or null',
    description:
      'Ready, open, unblocked by its sub-issues, unassigned or assigned to the caller; then by priority, then by how long it has waited. A pure projection query: no request leaves the host.',
    response: NextTaskResponse, parameters: [slugParameter, actorHeader], errors: [404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const repositoryIds = await workspaceRepositoryIds(db, c.req.param('slug'))
    if (repositoryIds.length === 0) return c.json({ task: null })
    const issues = await db.github.listIssues({ repositoryIds })
    const links = await db.github.listRelationships()
    const chosen = nextTask(issues, links, { actor: readActor(c.req.header('X-Portta-Actor')) })
    return c.json({ task: chosen ? await present(db, chosen) : null })
  })

  app.get('/tasks/:ref', documentRoute({
    tag: 'Tasks', operationId: 'getTask', summary: 'Get one task',
    description: 'Addressable by `owner/repo#number` or by projected id. A coordinate outside the repository projection is refused before any GitHub request.',
    response: Issue, parameters: [refParameter], errors: [400, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    return c.json(await present(db, await resolve(db, c.req.param('ref'))))
  })

  app.get('/tasks/:ref/subtasks', documentRoute({
    tag: 'Tasks', operationId: 'getSubtasks', summary: 'The sub-issue graph under one task, as a tree',
    response: SubtasksResponse, parameters: [refParameter], errors: [400, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const task = await resolve(db, c.req.param('ref'))
    const issues = await db.github.listIssues({})
    const links = await db.github.listRelationships()
    const tree = subtaskTree(task.id, issues, links)

    // One pass over the whole graph, then the tree is rebuilt from the views:
    // assembling per node would read the Git scan once per subtask.
    const flat = new Map((await presentAll(db, collect(tree))).map((view) => [view.id, view]))
    const render = (nodes: typeof tree): unknown[] =>
      nodes.flatMap((node) => {
        const view = flat.get(node.task.id)
        return view ? [{ task: view, children: render(node.children) }] : []
      })
    return c.json({ subtasks: render(tree) })
  })

  // --- writes: GitHub first, projection from the response ------------------

  app.post('/tasks/:ref/start', documentRoute({
    tag: 'Tasks', operationId: 'startTask', summary: 'Take a task',
    description: 'Sets the status to in_progress and, unless assign is false, assigns the actor — in one confirmed write, so a task is never half-taken.',
    request: StartBody, response: Issue, parameters: [refParameter, actorHeader],
    errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    // Before the body: "there is no App" is the answer to give, not "your body
    // has an extra key".
    requireGitHub()
    const task = await resolve(db, c.req.param('ref'))
    const body = StartBody.parse(await c.req.json().catch(() => ({})))
    const actor = readActor(c.req.header('X-Portta-Actor'))
    return c.json(await transition(db, task, startPlan(task, body.assign === false ? null : actor), actor))
  })

  app.post('/tasks/:ref/status', documentRoute({
    tag: 'Tasks', operationId: 'setTaskStatus', summary: 'Move a task to one workflow status',
    request: StatusBody, response: Issue, parameters: [refParameter, actorHeader],
    errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    requireGitHub()
    const task = await resolve(db, c.req.param('ref'))
    const body = StatusBody.parse(await c.req.json())
    const actor = readActor(c.req.header('X-Portta-Actor'))
    return c.json(await transition(db, task, { status: body.status as WorkflowStatus, state: null, assignees: null }, actor))
  })

  app.post('/tasks/:ref/finish', documentRoute({
    tag: 'Tasks', operationId: 'finishTask', summary: 'Finish a task',
    description: 'Sets the status to done and, when close is true, closes the issue — in one confirmed write.',
    request: FinishBody, response: Issue, parameters: [refParameter, actorHeader],
    errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    requireGitHub()
    const task = await resolve(db, c.req.param('ref'))
    const body = FinishBody.parse(await c.req.json().catch(() => ({})))
    const actor = readActor(c.req.header('X-Portta-Actor'))
    return c.json(await transition(db, task, finishPlan(body.close === true), actor))
  })

  /**
   * Write-through, and deliberately asymmetric.
   *
   * It posts to GitHub and returns the response. Nothing is projected: there is
   * no comment table, no sync path and therefore no cache to keep in step, so
   * reading a discussion stays a link to GitHub. See ADR 0018's 2026-09-02
   * amendment, which is what allows this endpoint at all.
   */
  app.post('/tasks/:ref/comments', documentRoute({
    tag: 'Tasks', operationId: 'commentOnTask', summary: 'Comment on a task',
    description: 'Posts straight to GitHub and returns what GitHub returned. Comments are never projected.',
    request: CommentBody, response: CommentResponse, status: 201,
    parameters: [refParameter, actorHeader], errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const github = requireGitHub()
    const task = await resolve(db, c.req.param('ref'))
    const repository = await db.github.findRepository(task.repository)
    if (!repository) {
      throw new OverrideRefused(`${task.repository} is not a repository this gateway was granted`)
    }
    const body = CommentBody.parse(await c.req.json())
    const actor = readActor(c.req.header('X-Portta-Actor'))

    const created = await github.require().postAsInstallation<{ id: number; html_url: string; body: string; created_at: string }>(
      repository.installationId,
      `/repos/${task.repository}/issues/${task.number}/comments`,
      { body: body.body },
    )
    process.stdout.write(
      `task ${task.repository}#${task.number} commented${actor ? ` by ${actor}` : ''}\n`,
    )
    return c.json({
      id: created.data.id,
      htmlUrl: created.data.html_url,
      body: created.data.body,
      createdAt: created.data.created_at,
    }, 201)
  })

  return app
}

/** Every node in a subtask tree, flattened, so the views are read in one pass. */
function collect(nodes: SubtaskNode<StoredIssue>[]): StoredIssue[] {
  return nodes.flatMap((node) => [node.task, ...collect(node.children)])
}
