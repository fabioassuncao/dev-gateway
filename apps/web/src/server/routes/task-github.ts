// The GitHub binding of a task: link, unlink, publish, sync, comment.
//
// The projection stays a cache with an age. A binding is one row that says
// which issue a task is; these verbs create it, remove it, push what is
// pending across it, and pass a comment straight through. Every verb that
// reaches GitHub needs the App; the ones that only touch the row do not.

import { Hono } from 'hono'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import { parseTaskRef } from 'portta-core'
import type { AppDeps } from './deps.ts'
import { requireDatabase, type Database } from '../db/index.ts'
import { OverrideRefused } from '../core/overrides.ts'
import { labelsAfter, type Priority, type WorkflowStatus } from '../integrations/github/metadata.ts'
import { normaliseIssue, type RawIssue } from '../integrations/github/issues.ts'
import { applyIssueToTask, fieldsFor } from '../integrations/github/tasks.ts'
import { loadTaskContext, taskView } from '../core/task-view.ts'
import { pushToGitHub, resolveTask, wholeChange } from '../core/task-write.ts'
import { recordActivity } from '../core/activity.ts'
import { principalOf } from '../principal.ts'
import { Task } from '../../shared/task-types.ts'
import { documentRoute } from '../openapi.ts'
import { actorHeader, refParameter } from './tasks.ts'

const LinkBody = z.object({ issue: z.string().min(3).max(200).describe('`owner/repo#number`, already projected') }).strict().meta({ ref: 'LinkTaskBody' })
const PublishBody = z.object({ repository: z.string().min(3).max(200).optional().describe('`owner/name`; defaults to the GitHub repository of the task repository') }).strict().meta({ ref: 'PublishTaskBody' })
const SyncBody = z.object({ resolve: z.enum(['local', 'remote']).optional() }).strict().meta({ ref: 'SyncTaskBody' })
const CommentBody = z.object({ body: z.string().min(1).max(65536) }).strict().meta({ ref: 'TaskCommentBody' })
/** A comment is returned as GitHub returned it, because nothing stores it. */
const CommentResponse = z.object({ id: z.number(), htmlUrl: z.string(), body: z.string(), createdAt: z.string() }).strict().meta({ ref: 'TaskCommentResponse' })

export function taskGitHubRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  async function present(db: Database, id: string): Promise<Task> {
    const task = await db.tasks.find(id)
    if (!task) throw new HTTPException(404, { message: `no task '${id}'` })
    const ctx = await loadTaskContext(deps.config, db, await deps.cache.get())
    const [notes, sessions] = await Promise.all([db.tasks.listNotes(task.id), db.sessions.list({ taskId: task.id, status: ['active'] })])
    return taskView(ctx, task, notes, sessions)
  }

  function requireGitHub() {
    const github = deps.github
    if (github === null || !github.status().configured) {
      throw new OverrideRefused('the GitHub App is not configured, so nothing can reach GitHub', 'see docs/github.md')
    }
    return github
  }

  async function slugOf(db: Database, projectId: string): Promise<string> {
    return (await db.projects.list()).find((project) => project.id === projectId)?.slug ?? projectId
  }

  const ownerFor = (db: Database) => async (githubRepositoryId: string) => {
    const owner = await db.repositories.findByGitHub(githubRepositoryId)
    return owner ? { projectId: owner.projectId, repositoryId: owner.id } : null
  }

  app.post('/tasks/:ref/github/link', documentRoute({
    tag: 'Tasks', operationId: 'linkTaskToIssue', capability: 'task:sync', summary: 'Bind a task to a projected GitHub issue',
    description: 'The issue must already be projected and bound to no other task. On linking, the remote wins: the task takes the issue’s title, status and priority.',
    request: LinkBody, response: Task, parameters: [refParameter, actorHeader], errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const task = await resolveTask(db, c.req.param('ref'))
    const body = LinkBody.parse(await c.req.json())
    const ref = parseTaskRef(body.issue)
    if (!ref || ref.kind !== 'coordinate') throw new OverrideRefused(`'${body.issue}' is not owner/repo#number`)
    const repository = await db.github.findRepository(ref.repository)
    const issue = repository ? await db.github.findIssueByNumber(repository.id, ref.number) : null
    if (!issue) throw new HTTPException(404, { message: `no issue '${body.issue}' in the projection` })
    if (issue.isPullRequest) throw new OverrideRefused('a pull request is not a task')
    const taken = await db.tasks.findByIssue(issue.id)
    if (taken && taken.id !== task.id) throw new OverrideRefused(`${body.issue} is already bound to task ${taken.id}`)
    if (await db.tasks.findLink(task.id)) throw new OverrideRefused('this task is already bound; unlink it first')
    await db.tasks.upsertLink({ taskId: task.id, githubIssueId: issue.id, syncState: 'synced', lastSyncedAt: new Date(), localUpdatedAt: issue.githubUpdatedAt, remoteUpdatedAt: issue.githubUpdatedAt })
    const fields = fieldsFor(issue)
    await db.tasks.update(task.id, { title: fields.title, description: fields.description, status: fields.status, priority: fields.priority, type: fields.type, labels: fields.labels, assignee: fields.assignee })
    const principal = principalOf(c)
    const slug = await slugOf(db, task.projectId)
    await recordActivity({ db, hub: deps.hub }, {
      kind: 'task.linked', actor: principal.actor, actorKind: principal.actorKind, project: slug,
      projectId: task.projectId, taskId: task.id, repositoryId: task.repositoryId,
      summary: `"${task.title}" bound to ${body.issue}`, data: { issue: body.issue },
    })
    deps.hub.publish({ kind: 'task', action: 'linked', id: task.id, name: task.title, project: slug, ownership: null, at: Math.floor(Date.now() / 1000) })
    return c.json(await present(db, task.id))
  })

  app.post('/tasks/:ref/github/unlink', documentRoute({
    tag: 'Tasks', operationId: 'unlinkTaskFromIssue', capability: 'task:sync', summary: 'Remove the GitHub binding of a task',
    description: 'The task and the issue both stay; they just stop following each other.',
    response: Task, parameters: [refParameter, actorHeader], errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const task = await resolveTask(db, c.req.param('ref'))
    if (!(await db.tasks.removeLink(task.id))) throw new OverrideRefused('this task is not bound to an issue')
    const principal = principalOf(c)
    const slug = await slugOf(db, task.projectId)
    await recordActivity({ db, hub: deps.hub }, {
      kind: 'task.linked', actor: principal.actor, actorKind: principal.actorKind, project: slug,
      projectId: task.projectId, taskId: task.id, summary: `"${task.title}" unbound from GitHub`, data: { unlinked: true },
    })
    return c.json(await present(db, task.id))
  })

  app.post('/tasks/:ref/github/publish', documentRoute({
    tag: 'Tasks', operationId: 'publishTask', capability: 'task:sync', summary: 'Open a GitHub issue for a task and bind them',
    description: 'Creates the issue on GitHub, projects what GitHub returned, and binds the task to it. Needs the App and a granted repository.',
    request: PublishBody, response: Task, status: 201, parameters: [refParameter, actorHeader], errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const github = requireGitHub()
    const task = await resolveTask(db, c.req.param('ref'))
    if (task.draft) throw new OverrideRefused('give the task a real title before publishing it to GitHub')
    if (await db.tasks.findLink(task.id)) throw new OverrideRefused('this task is already bound to an issue')
    const body = PublishBody.parse(await c.req.json().catch(() => ({})))
    let fullName = body.repository ?? null
    if (fullName === null && task.repositoryId) {
      const repository = await db.repositories.find(task.repositoryId)
      fullName = repository?.github?.fullName ?? null
    }
    if (fullName === null) throw new OverrideRefused('no GitHub repository to publish to', 'give repository: owner/name, or bind the task repository to GitHub')
    // The projection is the authorisation boundary with GitHub; the Project is
    // the boundary inside Portta. A task is published only to a repository its
    // own Project owns, never to one another Project bound.
    const owned = (await db.repositories.list(task.projectId)).some((entry) => entry.github?.fullName === fullName)
    if (!owned) throw new OverrideRefused(`${fullName} is not a GitHub repository of this task's Project`, 'bind it to the Project first')
    const repository = await db.github.findRepository(fullName)
    if (!repository) throw new OverrideRefused(`${fullName} is not a repository this gateway was granted`)
    const labels = labelsAfter(task.labels, { status: task.status as WorkflowStatus, priority: task.priority as Priority | null })
    const created = await github.require().postAsInstallation<RawIssue>(repository.installationId, `/repos/${fullName}/issues`, {
      title: task.title,
      ...(task.description ? { body: task.description } : {}),
      ...(labels.length > 0 ? { labels } : {}),
      ...(task.assignee ? { assignees: [task.assignee] } : {}),
    })
    const record = normaliseIssue(created.data, repository.id)
    const issueId = await db.github.upsertIssue(record)
    await db.tasks.upsertLink({ taskId: task.id, githubIssueId: issueId, syncState: 'synced', lastSyncedAt: new Date(), localUpdatedAt: record.githubUpdatedAt, remoteUpdatedAt: record.githubUpdatedAt })
    const principal = principalOf(c)
    const slug = await slugOf(db, task.projectId)
    await recordActivity({ db, hub: deps.hub }, {
      kind: 'task.linked', actor: principal.actor, actorKind: principal.actorKind, project: slug,
      projectId: task.projectId, taskId: task.id, repositoryId: task.repositoryId,
      summary: `"${task.title}" published as ${fullName}#${record.number}`, data: { issue: `${fullName}#${record.number}` },
    })
    return c.json(await present(db, task.id), 201)
  })

  /**
   * Push what is pending, or settle a conflict the way the caller says.
   * `remote` re-applies the projection to the task; `local` pushes the task
   * whole. Without a choice, a conflict is refused with 409.
   */
  app.post('/tasks/:ref/github/sync', documentRoute({
    tag: 'Tasks', operationId: 'syncTask', capability: 'task:sync', summary: 'Push a pending local edit to GitHub, or settle a conflict',
    request: SyncBody, response: Task, parameters: [refParameter, actorHeader], errors: [400, 403, 404, 409, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const task = await resolveTask(db, c.req.param('ref'))
    const link = await db.tasks.findLink(task.id)
    if (!link) throw new OverrideRefused('this task is not bound to an issue')
    const body = SyncBody.parse(await c.req.json().catch(() => ({})))
    const issue = await db.github.findIssue(link.githubIssueId)
    if (!issue) throw new OverrideRefused('the bound issue is no longer projected')
    if (link.syncState === 'conflict' && body.resolve === undefined) {
      throw new HTTPException(409, { message: 'the task and its issue both changed; pass resolve: local or remote' })
    }
    const principal = principalOf(c)
    const slug = await slugOf(db, task.projectId)
    if (body.resolve === 'remote') {
      await db.tasks.setLinkState(task.id, 'synced', { lastError: null })
      const applied = await applyIssueToTask(db.tasks, issue, ownerFor(db))
      await recordActivity({ db, hub: deps.hub }, { kind: 'task.synced', actor: principal.actor, actorKind: principal.actorKind, project: slug, projectId: task.projectId, taskId: task.id, summary: `"${task.title}" took what GitHub has`, data: { outcome: applied.outcome } })
      return c.json(await present(db, task.id))
    }
    requireGitHub()
    const outcome = await pushToGitHub(db, deps.github, task, link, wholeChange(task, issue))
    await recordActivity({ db, hub: deps.hub }, { kind: outcome === 'synced' || outcome === 'nothing' ? 'task.synced' : 'task.conflict', actor: principal.actor, actorKind: principal.actorKind, project: slug, projectId: task.projectId, taskId: task.id, summary: outcome === 'synced' || outcome === 'nothing' ? `"${task.title}" pushed to GitHub` : `"${task.title}" could not be pushed to GitHub`, data: { outcome } })
    return c.json(await present(db, task.id))
  })

  /**
   * Write-through, and deliberately asymmetric: posts to GitHub and returns the
   * response. Nothing is projected, so reading a discussion stays a link to
   * GitHub. See ADR 0018's 2026-09-02 amendment.
   */
  app.post('/tasks/:ref/comments', documentRoute({
    tag: 'Tasks', operationId: 'commentOnTask', capability: 'task:sync', summary: 'Comment on the bound GitHub issue',
    description: 'Posts straight to GitHub and returns what GitHub returned. Comments are never projected. A local note is /notes.',
    request: CommentBody, response: CommentResponse, status: 201, parameters: [refParameter, actorHeader], errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const github = requireGitHub()
    const task = await resolveTask(db, c.req.param('ref'))
    const link = await db.tasks.findLink(task.id)
    const issue = link ? await db.github.findIssue(link.githubIssueId) : null
    if (!issue) throw new OverrideRefused('this task is not bound to an issue; add a local note instead')
    const repository = await db.github.findRepository(issue.repository)
    if (!repository) throw new OverrideRefused(`${issue.repository} is not a repository this gateway was granted`)
    const body = CommentBody.parse(await c.req.json())
    const created = await github.require().postAsInstallation<{ id: number; html_url: string; body: string; created_at: string }>(
      repository.installationId, `/repos/${issue.repository}/issues/${issue.number}/comments`, { body: body.body },
    )
    const principal = principalOf(c)
    await recordActivity({ db, hub: deps.hub }, { kind: 'task.note', actor: principal.actor, actorKind: principal.actorKind, project: await slugOf(db, task.projectId), projectId: task.projectId, taskId: task.id, summary: `${principal.actor ?? 'somebody'} commented on ${issue.repository}#${issue.number}`, data: { commentId: created.data.id, htmlUrl: created.data.html_url } })
    return c.json({ id: created.data.id, htmlUrl: created.data.html_url, body: created.data.body, createdAt: created.data.created_at }, 201)
  })

  return app
}
