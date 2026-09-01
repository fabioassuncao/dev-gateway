import { Hono } from 'hono'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import type { AppDeps } from './deps.ts'
import { requireDatabase, type Database } from '../db/index.ts'
import type { StoredIssue } from '../db/github.ts'
import { OverrideRefused } from '../core/overrides.ts'
import {
  isPriority,
  isWorkflowStatus,
  labelsAfter,
  type Priority,
  type WorkflowStatus,
} from '../integrations/github/metadata.ts'
import { normaliseIssue, type RawIssue } from '../integrations/github/issues.ts'
import { Issue } from '../../shared/types.ts'
import { documentRoute } from '../openapi.ts'

/** Past this age the projection is marked stale; it is still shown. */
const STALE_AFTER_SECONDS = 900

const IssuesResponse = z.object({ issues: z.array(Issue) }).strict().meta({ ref: 'IssuesResponse' })

const PatchIssueBody = z
  .object({
    status: z.enum(['backlog', 'ready', 'in_progress', 'review', 'blocked', 'done']).nullable().optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).nullable().optional(),
    state: z.enum(['open', 'closed']).optional(),
    assignees: z.array(z.string().min(1)).max(10).optional(),
    labels: z.array(z.string().min(1)).max(100).optional(),
  })
  .strict()
  .meta({ ref: 'PatchIssueBody' })

const CreateIssueBody = z
  .object({
    title: z.string().min(1).max(256),
    body: z.string().max(65536).optional(),
    status: z.enum(['backlog', 'ready', 'in_progress', 'review', 'blocked', 'done']).optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    labels: z.array(z.string().min(1)).max(100).optional(),
    assignees: z.array(z.string().min(1)).max(10).optional(),
  })
  .strict()
  .meta({ ref: 'CreateIssueBody' })

const issueIdParameter = {
  name: 'id',
  in: 'path' as const,
  required: true,
  description: 'The projected issue id, not the GitHub number.',
  schema: { type: 'string' as const },
}

function seconds(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

function view(
  issue: StoredIssue,
  relationships: { parentId: string; childId: string }[],
  now: number,
): z.infer<typeof Issue> {
  const syncedAt = seconds(issue.syncedAt)
  return {
    id: issue.id,
    repository: issue.repository,
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state === 'closed' ? 'closed' : 'open',
    stateReason: issue.stateReason,
    issueType: issue.issueType,
    status: issue.workflowStatus === null ? null : (issue.workflowStatus as WorkflowStatus),
    priority: issue.priority === null ? null : (issue.priority as Priority),
    metadataSource: (issue.metadataSource as 'fields' | 'labels' | 'none') ?? 'none',
    labels: issue.labels,
    assignees: issue.assignees,
    milestone: issue.milestone,
    htmlUrl: issue.htmlUrl,
    parentId: relationships.find((link) => link.childId === issue.id)?.parentId ?? null,
    childIds: relationships.filter((link) => link.parentId === issue.id).map((link) => link.childId),
    githubUpdatedAt: seconds(issue.githubUpdatedAt),
    syncedAt,
    stale: now - syncedAt > STALE_AFTER_SECONDS,
  }
}

/** Repositories one workspace owns, as projection ids. */
async function workspaceRepositoryIds(db: Database, slug: string): Promise<string[]> {
  const workspace = await db.workspaces.find(slug)
  if (!workspace) throw new HTTPException(404, { message: `no workspace '${slug}'` })
  const links = await db.workspaces.listRepositories()
  return links.filter((link) => link.workspaceId === workspace.id).map((link) => link.repositoryId)
}

function matches(issue: StoredIssue, query: URLSearchParams): boolean {
  const equals = (key: string, value: string | null) => {
    const wanted = query.get(key)
    return wanted === null || (value !== null && value.toLowerCase() === wanted.toLowerCase())
  }

  if (!equals('repository', issue.repository)) return false
  if (!equals('state', issue.state)) return false
  if (!equals('status', issue.workflowStatus)) return false
  if (!equals('priority', issue.priority)) return false
  if (!equals('type', issue.issueType)) return false

  const assignee = query.get('assignee')
  if (assignee !== null && !issue.assignees.some((login) => login.toLowerCase() === assignee.toLowerCase())) {
    return false
  }
  const label = query.get('label')
  if (label !== null && !issue.labels.some((name) => name.toLowerCase() === label.toLowerCase())) {
    return false
  }
  const milestone = query.get('milestone')
  if (milestone !== null && (issue.milestone?.title ?? '').toLowerCase() !== milestone.toLowerCase()) {
    return false
  }
  const text = query.get('q')
  if (text !== null && !`${issue.number} ${issue.title}`.toLowerCase().includes(text.toLowerCase())) {
    return false
  }
  return true
}

const FILTERS = [
  ['repository', 'Filter by owner/name.'],
  ['state', 'open or closed.'],
  ['status', 'backlog, ready, in_progress, review, blocked or done.'],
  ['priority', 'low, medium, high or urgent.'],
  ['type', "GitHub's issue type, where the repository has them."],
  ['assignee', 'GitHub login.'],
  ['milestone', 'Milestone title.'],
  ['label', 'Exact label name.'],
  ['q', 'Substring of the number or title.'],
] as const

const filterParameters = FILTERS.map(([name, description]) => ({
  name,
  in: 'query' as const,
  required: false,
  description,
  schema: { type: 'string' as const },
}))

export function issueRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  async function listing(db: Database, repositoryIds: string[] | undefined, query: URLSearchParams) {
    const [issues, relationships] = await Promise.all([
      db.github.listIssues({ repositoryIds, state: query.get('state') ?? undefined }),
      db.github.listRelationships(),
    ])
    const now = Math.floor(Date.now() / 1000)
    return issues.filter((issue) => matches(issue, query)).map((issue) => view(issue, relationships, now))
  }

  app.get('/workspaces/:slug/issues', documentRoute({
    tag: 'Issues', operationId: 'listWorkspaceIssues',
    summary: "List issues across a workspace's repositories", response: IssuesResponse,
    description: 'Served from the projection, so it answers while GitHub is unreachable; every row carries syncedAt and a staleness flag.',
    parameters: [
      { name: 'slug', in: 'path', required: true, description: 'The workspace slug.', schema: { type: 'string' } },
      ...filterParameters,
    ],
    errors: [404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const repositoryIds = await workspaceRepositoryIds(db, c.req.param('slug'))
    const query = new URL(c.req.url).searchParams
    return c.json({ issues: repositoryIds.length === 0 ? [] : await listing(db, repositoryIds, query) })
  })

  app.get('/issues', documentRoute({
    tag: 'Issues', operationId: 'listIssues', summary: 'List projected issues',
    response: IssuesResponse, parameters: filterParameters, errors: [500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    return c.json({ issues: await listing(db, undefined, new URL(c.req.url).searchParams) })
  })

  app.get('/issues/:id', documentRoute({
    tag: 'Issues', operationId: 'getIssue', summary: 'Get one issue with its sub-issue links',
    response: Issue, parameters: [issueIdParameter], errors: [404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const issue = await db.github.findIssue(c.req.param('id'))
    if (!issue) throw new HTTPException(404, { message: `no issue '${c.req.param('id')}'` })
    const relationships = await db.github.listRelationships()
    return c.json(view(issue, relationships, Math.floor(Date.now() / 1000)))
  })

  /**
   * Writes through to GitHub, then updates the projection from GitHub's answer.
   *
   * Never from what was requested: the panel must not show an issue GitHub did
   * not confirm. A repository outside the installation is refused before a
   * request leaves, and the response says which mechanism carried the change,
   * because writing a status through labels shows in the issue's timeline.
   */
  app.patch('/issues/:id', documentRoute({
    tag: 'Issues', operationId: 'patchIssue', summary: 'Change an issue on GitHub',
    description: 'Writes to GitHub and updates the projection from the response. Refused in read-only mode and for a repository outside the installation.',
    request: PatchIssueBody, response: Issue,
    parameters: [issueIdParameter], errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const github = deps.github
    if (github === null || !github.status().configured) {
      throw new OverrideRefused(
        'the GitHub App is not configured, so nothing can be written back',
        'see docs/github.md',
      )
    }

    const issue = await db.github.findIssue(c.req.param('id'))
    if (!issue) throw new HTTPException(404, { message: `no issue '${c.req.param('id')}'` })

    // The projection is the authorisation boundary: an issue whose repository
    // is no longer granted cannot be written.
    const repository = await db.github.findRepository(issue.repository)
    if (!repository) {
      throw new OverrideRefused(`${issue.repository} is not a repository this gateway was granted`)
    }

    const body = PatchIssueBody.parse(await c.req.json())
    const patch: Record<string, unknown> = {}
    if (body.state) patch['state'] = body.state
    if (body.assignees) patch['assignees'] = body.assignees

    const wantsStatus = Object.hasOwn(body, 'status')
    const wantsPriority = Object.hasOwn(body, 'priority')
    if (wantsStatus || wantsPriority) {
      patch['labels'] = labelsAfter(body.labels ?? issue.labels, {
        ...(wantsStatus ? { status: body.status ?? null } : {}),
        ...(wantsPriority ? { priority: body.priority ?? null } : {}),
      })
    } else if (body.labels) {
      patch['labels'] = body.labels
    }

    if (Object.keys(patch).length === 0) {
      throw new OverrideRefused('nothing to change')
    }

    const client = github.require()
    const updated = await client.patchAsInstallation<RawIssue>(
      repository.installationId,
      `/repos/${issue.repository}/issues/${issue.number}`,
      patch,
    )

    const record = normaliseIssue(updated.data, issue.repositoryId)
    await db.github.upsertIssue(record)

    const fresh = await db.github.findIssue(issue.id)
    const relationships = await db.github.listRelationships()
    deps.hub.publish({
      kind: 'config',
      action: 'issue',
      id: issue.id,
      name: `${issue.repository}#${issue.number}`,
      project: null,
      ownership: null,
      at: Math.floor(Date.now() / 1000),
    })
    return c.json(view(fresh ?? issue, relationships, Math.floor(Date.now() / 1000)))
  })

  /**
   * Creates an issue on GitHub, then projects what GitHub returned.
   *
   * The panel never shows an issue GitHub did not confirm, so there is no
   * optimistic row here: the response is the projection.
   */
  app.post('/repositories/:owner/:repo/issues', documentRoute({
    tag: 'Issues', operationId: 'createIssue', summary: 'Open an issue on GitHub',
    request: CreateIssueBody, response: Issue, status: 201,
    parameters: [
      {
        name: 'owner', in: 'path', required: true,
        description: 'Repository owner; it must be one the installation granted.',
        schema: { type: 'string' },
      },
      {
        name: 'repo', in: 'path', required: true,
        description: 'Repository name.',
        schema: { type: 'string' },
      },
    ],
    errors: [400, 403, 404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const github = deps.github
    if (github === null || !github.status().configured) {
      throw new OverrideRefused(
        'the GitHub App is not configured, so nothing can be created',
        'see docs/github.md',
      )
    }

    const fullName = `${c.req.param('owner')}/${c.req.param('repo')}`
    const repository = await db.github.findRepository(fullName)
    if (!repository) {
      throw new OverrideRefused(`${fullName} is not a repository this gateway was granted`)
    }

    const body = CreateIssueBody.parse(await c.req.json())
    const labels = labelsAfter(body.labels ?? [], {
      ...(body.status === undefined ? {} : { status: body.status }),
      ...(body.priority === undefined ? {} : { priority: body.priority }),
    })

    const created = await github.require().postAsInstallation<RawIssue>(
      repository.installationId,
      `/repos/${fullName}/issues`,
      {
        title: body.title,
        ...(body.body === undefined ? {} : { body: body.body }),
        ...(labels.length === 0 ? {} : { labels }),
        ...(body.assignees === undefined ? {} : { assignees: body.assignees }),
      },
    )

    const record = normaliseIssue(created.data, repository.id)
    const id = await db.github.upsertIssue(record)
    const fresh = await db.github.findIssue(id)
    const relationships = await db.github.listRelationships()
    return c.json(view(fresh!, relationships, Math.floor(Date.now() / 1000)), 201)
  })

  return app
}

export { isPriority, isWorkflowStatus }
