// The task endpoints, over Portta's own tasks.
//
// The scheduling rules (next, blocked-by-subtasks, priority order) live in
// portta-core and are tested there. What is asserted here is the contract:
// local-first writes, the GitHub binding following when it can, the actor
// carried through, and read-only and capability refusals.

import { describe, expect, it } from 'vitest'
import type { Database } from '../../src/server/db/index.ts'
import type { GitHubIntegration } from '../../src/server/integrations/github/index.ts'
import { GATEWAY, PROJECT_A } from './fixtures.ts'
import { makeApp, post } from './helpers.ts'
import { fakeActivity, fakeSessions, fakeTasks, type FakeActivity, type FakeTasks } from './fake-work.ts'

const NOW = new Date('2026-01-01T12:00:00Z')

function issueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '1', githubId: 1, nodeId: 'I_1', repositoryId: 'r1', repository: 'acme/api',
    number: 123, title: 'Implementar refresh token', body: null, state: 'open',
    stateReason: null, issueType: null, workflowStatus: 'ready', priority: 'high',
    metadataSource: 'labels', labels: ['status:ready'], assignees: [],
    milestone: null, htmlUrl: 'https://github.com/acme/api/issues/123',
    isPullRequest: false, githubUpdatedAt: NOW, syncedAt: NOW,
    ...overrides,
  }
}

interface Work { db: Database; tasks: FakeTasks; activity: FakeActivity; issues: Record<string, unknown>[] }

function work(issues: Record<string, unknown>[] = [], repository: unknown = { id: 'r1', fullName: 'acme/api', installationId: 99 }): Work {
  const tasks = fakeTasks()
  const activity = fakeActivity()
  const db = {
    status: () => ({ configured: true, available: true, reason: null, checkedAt: 0, migrations: [] }),
    environments: {
      find: async (name: string) => (name === 'alpha' ? { id: 'e1', composeProject: 'alpha' } : null),
      upsertSeen: async () => ({}),
      list: async () => [{ id: 'e1', composeProject: 'alpha' }],
    },
    settings: { listAllEnvironment: async () => [], listAllService: async () => [], getGlobal: async () => null },
    repositories: {
      list: async (projectId?: string) => (projectId === undefined || projectId === 'w1' ? [{ id: '10', projectId: 'w1', name: 'api', githubRepositoryId: 'r1', github: { repositoryId: 'r1', fullName: 'acme/api' } }] : []),
      find: async (id: string) => (id === '10' ? { id: '10', projectId: 'w1', name: 'api', githubRepositoryId: 'r1', github: { repositoryId: 'r1', fullName: 'acme/api', htmlUrl: 'https://github.com/acme/api' } } : null),
      findByGitHub: async (id: string) => (id === 'r1' ? { id: '10', projectId: 'w1', name: 'api' } : null),
    },
    projects: {
      find: async (slug: string) => (slug === 'produto' ? { id: 'w1', slug, name: 'Produto' } : null),
      list: async () => [{ id: 'w1', slug: 'produto', name: 'Produto' }],
      listEnvironments: async () => [],
    },
    github: {
      listIssues: async () => issues,
      findIssue: async (id: string) => issues.find((entry) => entry['id'] === id) ?? null,
      findIssueByNumber: async (repositoryId: string, number: number) => issues.find((entry) => entry['repositoryId'] === repositoryId && entry['number'] === number) ?? null,
      listRelationships: async () => [],
      findRepository: async () => repository,
      listRepositories: async () => [],
      upsertIssue: async (record: Record<string, unknown>) => {
        const existing = issues.find((entry) => entry['githubId'] === record['githubId'])
        if (existing) {
          Object.assign(existing, record)
          return String(existing['id'])
        }
        const created = { ...record, id: String(record['githubId']), repository: 'acme/api', syncedAt: NOW }
        issues.push(created)
        return created.id
      },
    },
    tasks, sessions: fakeSessions(), activity,
  } as unknown as Database
  return { db, tasks, activity, issues }
}

/** A GitHub integration that confirms every write, and records what was sent. */
function fakeGitHub(sent: Record<string, unknown>[] = []) {
  const client = {
    patchAsInstallation: async (_id: number, _path: string, patch: Record<string, unknown>) => {
      sent.push(patch)
      return { data: { id: 1, node_id: 'I_1', number: 123, title: 'Implementar refresh token', body: null, state: patch['state'] ?? 'open', state_reason: null, labels: ((patch['labels'] as string[] | undefined) ?? []).map((name) => ({ name })), assignees: ((patch['assignees'] as string[] | undefined) ?? []).map((login) => ({ login })), milestone: null, html_url: 'https://github.com/acme/api/issues/123', updated_at: new Date(NOW.getTime() + 60_000).toISOString() }, next: null }
    },
    postAsInstallation: async (_id: number, path: string, body: Record<string, unknown>) => {
      sent.push({ path, ...body })
      if (path.endsWith('/comments')) {
        return { data: { id: 55, html_url: 'https://github.com/acme/api/issues/123#issuecomment-55', body: String(body['body']), created_at: NOW.toISOString() }, next: null }
      }
      return { data: { id: 77, node_id: 'I_77', number: 124, title: String(body['title']), body: body['body'] ?? null, state: 'open', state_reason: null, labels: [], assignees: [], milestone: null, html_url: 'https://github.com/acme/api/issues/124', updated_at: NOW.toISOString() }, next: null }
    },
  }
  return {
    status: () => ({ configured: true, available: true, reason: null, appId: 1, checkedAt: 0 }),
    require: () => client,
    check: async () => ({ available: true }),
    keyIsPrivate: () => true,
  } as unknown as GitHubIntegration
}

const json = (response: Response) => response.json() as Promise<Record<string, any>>

describe('local tasks', () => {
  it('creates, lists, reads and deletes a task with no GitHub at all', async () => {
    const { db, activity } = work()
    const { app } = makeApp({ containers: GATEWAY }, {}, db)

    const created = await post(app, '/api/projects/produto/tasks', { title: 'Rever autenticação', priority: 'high' }, { 'X-Portta-Actor': 'fabio', 'X-Portta-Actor-Kind': 'human' })
    expect(created.status).toBe(201)
    const task = await json(created)
    expect(task).toMatchObject({ title: 'Rever autenticação', status: 'backlog', priority: 'high', project: 'produto', github: null, createdBy: 'fabio', environments: [], notes: [] })
    expect(task.panelUrl).toBe(`#/projects/produto/tasks/${task.id}`)

    const listed = await json(await app.request('/api/projects/produto/tasks'))
    expect(listed.tasks).toHaveLength(1)
    expect(await json(await app.request(`/api/tasks/${task.id}`))).toMatchObject({ id: task.id })
    expect(await json(await app.request(`/api/tasks/%23${task.id}`))).toMatchObject({ id: task.id })
    expect(activity.rows[0]).toMatchObject({ kind: 'task.created', actor: 'fabio', actorKind: 'human', taskId: task.id })

    const removed = await app.request(`/api/tasks/${task.id}`, { method: 'DELETE', headers: { origin: 'http://localhost', host: 'localhost' } })
    expect(removed.status).toBe(200)
    expect((await json(await app.request('/api/projects/produto/tasks'))).tasks).toEqual([])
  })

  it('offers the next task, and null when there is none', async () => {
    const { db, tasks } = work()
    tasks.seed({ projectId: 'w1', title: 'backlog', status: 'backlog' })
    const ready = tasks.seed({ projectId: 'w1', title: 'ready', status: 'ready', priority: 'low' })
    const { app } = makeApp({ containers: GATEWAY }, {}, db)
    expect((await json(await app.request('/api/projects/produto/tasks/next'))).task).toMatchObject({ id: ready.id })
    ready.status = 'in_progress'
    expect((await json(await app.request('/api/projects/produto/tasks/next'))).task).toBeNull()
  })

  it('nests subtasks, counts them, and refuses a parent from another Project', async () => {
    const { db, tasks } = work()
    const parent = tasks.seed({ projectId: 'w1', title: 'Parent' })
    tasks.seed({ projectId: 'w1', title: 'Child', parentId: parent.id, status: 'done' })
    tasks.seed({ projectId: 'w1', title: 'Other child', parentId: parent.id })
    tasks.seed({ projectId: 'w2', title: 'Elsewhere' })
    const { app } = makeApp({ containers: GATEWAY }, {}, db)
    const tree = await json(await app.request(`/api/tasks/${parent.id}/subtasks`))
    expect(tree.subtasks.map((node: { task: { title: string } }) => node.task.title)).toEqual(['Child', 'Other child'])
    expect(await json(await app.request(`/api/tasks/${parent.id}`))).toMatchObject({ subtaskCount: 2, openSubtaskCount: 1 })
    const elsewhere = tasks.rows.find((row) => row.title === 'Elsewhere')!
    const refused = await post(app, '/api/projects/produto/tasks', { title: 'x', parentId: elsewhere.id })
    expect(refused.status).toBe(400)
  })

  it('starts, moves and finishes a task, recording the actor on the way', async () => {
    const { db, tasks, activity } = work()
    const task = tasks.seed({ projectId: 'w1', title: 'Fix auth', status: 'ready' })
    const { app } = makeApp({ containers: GATEWAY }, {}, db)
    const started = await json(await post(app, `/api/tasks/${task.id}/start`, {}, { 'X-Portta-Actor': 'claude-code' }))
    expect(started).toMatchObject({ status: 'in_progress', assignee: 'claude-code', agent: 'claude-code' })
    expect(activity.rows[0]).toMatchObject({ kind: 'task.status', actor: 'claude-code', actorKind: 'agent' })

    const moved = await json(await post(app, `/api/tasks/${task.id}/status`, { status: 'review' }))
    expect(moved.status).toBe('review')
    expect((await post(app, `/api/tasks/${task.id}/status`, { status: 'shipped' })).status).toBe(400)

    const finished = await json(await post(app, `/api/tasks/${task.id}/finish`, {}))
    expect(finished.status).toBe('done')
    expect(finished.closedAt).not.toBeNull()
  })

  it('persists sparse ordering within and across board columns', async () => {
    const { db, tasks, activity } = work()
    const first = tasks.seed({ projectId: 'w1', title: 'First', status: 'ready', position: 1024 })
    const second = tasks.seed({ projectId: 'w1', title: 'Second', status: 'ready', position: 2048 })
    const blocked = tasks.seed({ projectId: 'w1', title: 'Blocked', status: 'blocked', position: 1024 })
    const { app } = makeApp({ containers: GATEWAY }, {}, db)
    const moved = await json(await post(app, `/api/tasks/${second.id}/move`, { status: 'ready', beforeId: null, afterId: first.id }, { 'X-Portta-Actor': 'codex', 'X-Portta-Source': 'cli' }))
    expect(moved.position).toBeLessThan(first.position)
    const listed = await json(await app.request('/api/projects/produto/tasks'))
    expect(listed.tasks.filter((item: { status: string }) => item.status === 'ready').map((item: { id: string }) => item.id)).toEqual([second.id, first.id])
    const crossed = await json(await post(app, `/api/tasks/${first.id}/move`, { status: 'blocked', beforeId: blocked.id, afterId: null }))
    expect(crossed).toMatchObject({ status: 'blocked' })
    expect(crossed.position).toBeGreaterThan(blocked.position)
    expect(activity.rows.find((event) => event.source === 'cli')).toMatchObject({ source: 'cli', data: { position: { from: 2048 } } })
  })

  it('PATCH of status appends in the destination column and names the field that changed', async () => {
    const { db, tasks, activity } = work()
    const ready = tasks.seed({ projectId: 'w1', title: 'Stay', status: 'ready', position: 1024 })
    const task = tasks.seed({ projectId: 'w1', title: 'Ship metrics', status: 'backlog', position: 1024, priority: 'low' })
    const { app } = makeApp({ containers: GATEWAY }, {}, db)
    const moved = await json(await app.request(`/api/tasks/${task.id}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'ready' }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
    }))
    expect(moved).toMatchObject({ status: 'ready' })
    expect(moved.position).toBeGreaterThan(ready.position)
    expect(activity.rows[0]).toMatchObject({ kind: 'task.status', summary: '"Ship metrics" moved to ready' })

    const prioritised = await json(await app.request(`/api/tasks/${task.id}`, {
      method: 'PATCH', body: JSON.stringify({ priority: 'high' }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
    }))
    expect(prioritised.priority).toBe('high')
    expect(activity.rows[0]).toMatchObject({ kind: 'task.updated', summary: '"Ship metrics" priority changed from low to high' })
  })

  it('keeps notes locally, with the actor', async () => {
    const { db, tasks } = work()
    const task = tasks.seed({ projectId: 'w1', title: 'Fix auth' })
    const { app } = makeApp({ containers: GATEWAY }, {}, db)
    const note = await json(await post(app, `/api/tasks/${task.id}/notes`, { body: 'tests pass' }, { 'X-Portta-Actor': 'claude-code' }))
    expect(note).toMatchObject({ body: 'tests pass', actor: 'claude-code', actorKind: 'agent' })
    expect((await json(await app.request(`/api/tasks/${task.id}/notes`))).notes).toHaveLength(1)
    expect((await json(await app.request(`/api/tasks/${task.id}`))).notes).toHaveLength(1)

    const edited = await json(await app.request(`/api/tasks/${task.id}/notes/${note.id}`, {
      method: 'PATCH', body: JSON.stringify({ body: 'tests still pass' }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost', 'X-Portta-Actor': 'claude-code' },
    }))
    expect(edited.body).toBe('tests still pass')
    expect(edited.updatedAt).not.toBeNull()

    const refused = await app.request(`/api/tasks/${task.id}/notes/${note.id}`, {
      method: 'PATCH', body: JSON.stringify({ body: 'no' }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost', 'X-Portta-Actor': 'someone-else' },
    })
    expect(refused.status).toBe(400)

    const removed = await json(await app.request(`/api/tasks/${task.id}/notes/${note.id}`, {
      method: 'DELETE',
      headers: { origin: 'http://localhost', host: 'localhost', 'X-Portta-Actor': 'claude-code' },
    }))
    expect(removed).toMatchObject({ ok: true, removed: note.id })
    expect((await json(await app.request(`/api/tasks/${task.id}/notes`))).notes).toHaveLength(0)
  })

  it('links a task to a running environment by hand, and refuses one that is not', async () => {
    const { db, tasks } = work()
    const task = tasks.seed({ projectId: 'w1', title: 'Fix auth' })
    const { app, docker } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, {}, db)
    const put = (environments: string[]) => app.request(`/api/tasks/${task.id}/environments`, {
      method: 'PUT', body: JSON.stringify({ environments }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
    })
    const linked = await json(await put(['alpha']))
    expect(linked.environments[0]).toMatchObject({ environment: 'alpha', source: 'manual', running: true, panelUrl: '#/environments/alpha' })
    expect((await put(['ghost'])).status).toBe(400)
    expect(docker.calls.filter((call) => ['start', 'stop', 'restart', 'remove'].includes(call.method))).toEqual([])
  })

  it('reads a task out of an environment by its portta.task label, branch or namespace', async () => {
    const { db, tasks } = work()
    const task = tasks.seed({ projectId: 'w1', title: 'Fix auth' })
    const containers = PROJECT_A.map((container) => ({ ...container, labels: { ...container.labels, 'portta.task': `#${task.id}` } }))
    const { app } = makeApp({ containers: [...GATEWAY, ...containers] }, {}, db)
    const environment = await json(await app.request('/api/environments/alpha'))
    expect(environment.task).toMatchObject({ id: task.id, title: 'Fix auth', source: 'label', github: null, panelUrl: `#/projects/produto/tasks/${task.id}` })
    expect(environment.issue).toBeUndefined()
  })
})

describe('the GitHub binding', () => {
  it('reaches GitHub first on a bound task, and the binding says synced', async () => {
    const { db, tasks, issues } = work([issueRow()])
    const task = tasks.seed({ projectId: 'w1', title: 'Implementar refresh token', status: 'ready', repositoryId: '10' })
    await tasks.upsertLink({ taskId: task.id, githubIssueId: '1', syncState: 'synced', remoteUpdatedAt: NOW, localUpdatedAt: NOW })
    const sent: Record<string, unknown>[] = []
    const { app } = makeApp({ containers: GATEWAY }, {}, db, fakeGitHub(sent))

    const started = await json(await post(app, '/api/tasks/acme%2Fapi%23123/start', {}, { 'X-Portta-Actor': 'claude-code' }))
    expect(started.github).toMatchObject({ repository: 'acme/api', number: 123, syncState: 'synced' })
    expect(sent[0]).toMatchObject({ labels: ['status:in-progress'], assignees: ['claude-code'] })
    expect(JSON.stringify(sent)).not.toContain('X-Portta-Actor')
    expect(issues[0]!['workflowStatus']).toBe('in_progress')

    const finished = await json(await post(app, `/api/tasks/${task.id}/finish`, { close: true }))
    expect(sent[1]).toMatchObject({ labels: ['status:done'], state: 'closed' })
    expect(finished.github.state).toBe('closed')
  })

  it('writes locally and marks the binding pending when the App is not configured, then pushes on sync', async () => {
    const { db, tasks } = work([issueRow()])
    const task = tasks.seed({ projectId: 'w1', title: 'Implementar refresh token', status: 'ready' })
    await tasks.upsertLink({ taskId: task.id, githubIssueId: '1', syncState: 'synced', remoteUpdatedAt: NOW, localUpdatedAt: NOW })
    const { app } = makeApp({ containers: GATEWAY }, {}, db)
    const moved = await json(await post(app, `/api/tasks/${task.id}/status`, { status: 'review' }))
    expect(moved).toMatchObject({ status: 'review', github: { syncState: 'pending' } })

    expect((await post(app, `/api/tasks/${task.id}/github/sync`, {})).status).toBe(400)

    const sent: Record<string, unknown>[] = []
    const { app: connected } = makeApp({ containers: GATEWAY }, {}, db, fakeGitHub(sent))
    const synced = await json(await post(connected, `/api/tasks/${task.id}/github/sync`, {}))
    expect(synced.github.syncState).toBe('synced')
    expect(sent[0]).toMatchObject({ labels: ['status:review'] })
  })

  it('refuses to settle a conflict without a choice, and takes the remote when told to', async () => {
    const { db, tasks } = work([issueRow({ title: 'Remote title', workflowStatus: 'blocked', labels: ['status:blocked'] })])
    const task = tasks.seed({ projectId: 'w1', title: 'Local title', status: 'review' })
    await tasks.upsertLink({ taskId: task.id, githubIssueId: '1', syncState: 'conflict', remoteUpdatedAt: NOW, localUpdatedAt: NOW })
    const { app } = makeApp({ containers: GATEWAY }, {}, db, fakeGitHub())
    const shown = await json(await app.request(`/api/tasks/${task.id}`))
    expect(shown.github).toMatchObject({ syncState: 'conflict', remote: { title: 'Remote title', status: 'blocked' } })
    expect((await post(app, `/api/tasks/${task.id}/github/sync`, {})).status).toBe(409)
    const settled = await json(await post(app, `/api/tasks/${task.id}/github/sync`, { resolve: 'remote' }))
    expect(settled).toMatchObject({ title: 'Remote title', status: 'blocked', github: { syncState: 'synced' } })
  })

  it('links to a projected issue, refuses a pull request and an issue already bound, and unlinks', async () => {
    const { db, tasks } = work([issueRow(), issueRow({ id: '2', githubId: 2, number: 124, isPullRequest: true })])
    const task = tasks.seed({ projectId: 'w1', title: 'Local' })
    const other = tasks.seed({ projectId: 'w1', title: 'Other' })
    const { app } = makeApp({ containers: GATEWAY }, {}, db)
    expect((await post(app, `/api/tasks/${task.id}/github/link`, { issue: 'acme/api#124', initialSync: 'pull' })).status).toBe(400)
    const linked = await json(await post(app, `/api/tasks/${task.id}/github/link`, { issue: 'acme/api#123', initialSync: 'pull' }))
    expect(linked).toMatchObject({ title: 'Implementar refresh token', status: 'ready', priority: 'high', github: { number: 123, syncState: 'synced' } })
    expect((await post(app, `/api/tasks/${other.id}/github/link`, { issue: 'acme/api#123', initialSync: 'pull' })).status).toBe(400)
    expect((await json(await post(app, `/api/tasks/${task.id}/github/unlink`, {}))).github).toBeNull()
  })

  it('publishes a task as a new issue on the repository it belongs to', async () => {
    const { db, tasks } = work([])
    const task = tasks.seed({ projectId: 'w1', title: 'Ship it', status: 'ready', priority: 'urgent', repositoryId: '10' })
    const sent: Record<string, unknown>[] = []
    const { app } = makeApp({ containers: GATEWAY }, {}, db, fakeGitHub(sent))
    const published = await post(app, `/api/tasks/${task.id}/github/publish`, {})
    expect(published.status).toBe(201)
    expect(sent[0]).toMatchObject({ path: '/repos/acme/api/issues', title: 'Ship it', labels: ['status:ready', 'priority:urgent'] })
    expect((await json(published)).github).toMatchObject({ number: 124, syncState: 'synced' })
  })

  it('refuses to publish an intact draft', async () => {
    const { db, tasks } = work()
    const task = tasks.seed({ projectId: 'w1', title: 'New task', draft: true, repositoryId: '10' })
    const { app } = makeApp({ containers: GATEWAY }, {}, db, fakeGitHub())
    expect((await post(app, `/api/tasks/${task.id}/github/publish`, {})).status).toBe(400)
  })

  it('stores comments locally and only publishes an explicit copy to GitHub', async () => {
    const { db, tasks } = work([issueRow()])
    const bound = tasks.seed({ projectId: 'w1', title: 'Bound' })
    await tasks.upsertLink({ taskId: bound.id, githubIssueId: '1', syncState: 'synced' })
    const unbound = tasks.seed({ projectId: 'w1', title: 'Unbound' })
    const sent: Record<string, unknown>[] = []
    const { app } = makeApp({ containers: GATEWAY }, {}, db, fakeGitHub(sent))
    const comment = await post(app, `/api/tasks/${bound.id}/comments`, { body: 'done' }, { 'X-Portta-Actor': 'claude-code' })
    expect(comment.status).toBe(201)
    const local = await json(comment)
    expect(local).toMatchObject({ body: 'done', publishState: 'local' })
    expect(sent).toHaveLength(0)
    const published = await post(app, `/api/tasks/${bound.id}/comments/${local.id}/github/publish`, {})
    expect(await json(published)).toMatchObject({ body: 'done', publishState: 'synced', githubCommentId: 55 })
    expect(sent[0]).toEqual({ path: '/repos/acme/api/issues/123/comments', body: 'done' })
    const unboundComment = await json(await post(app, `/api/tasks/${unbound.id}/comments`, { body: 'x' }))
    expect((await post(app, `/api/tasks/${unbound.id}/comments/${unboundComment.id}/github/publish`, {})).status).toBe(400)
  })

  it('refuses a coordinate that is projected but bound to no task', async () => {
    const { db } = work([issueRow()])
    const { app } = makeApp({ containers: GATEWAY }, {}, db)
    expect((await app.request('/api/tasks/acme%2Fapi%23123')).status).toBe(404)
    expect((await app.request('/api/tasks/acme%2Fapi%23999')).status).toBe(404)
  })

  it('projects a new issue as a task on the repository that owns it, and follows a later change', async () => {
    const { applyIssueToTask } = await import('../../src/server/integrations/github/tasks.ts')
    const { db, tasks } = work()
    const owner = async () => ({ projectId: 'w1', repositoryId: '10' })
    const first = await applyIssueToTask(db.tasks, issueRow() as never, owner)
    expect(first.outcome).toBe('created')
    expect(first.task).toMatchObject({ title: 'Implementar refresh token', status: 'ready', priority: 'high', repositoryId: '10', createdBy: 'github' })

    const later = await applyIssueToTask(db.tasks, issueRow({ title: 'Renamed', githubUpdatedAt: new Date(NOW.getTime() + 60_000) }) as never, owner)
    expect(later.outcome).toBe('applied')
    expect(tasks.rows[0]!.title).toBe('Renamed')

    await tasks.setLinkState(first.task!.id, 'pending', { localUpdatedAt: new Date(NOW.getTime() + 120_000) })
    const clash = await applyIssueToTask(db.tasks, issueRow({ title: 'Renamed again', githubUpdatedAt: new Date(NOW.getTime() + 180_000) }) as never, owner)
    expect(clash.outcome).toBe('conflict')
    expect(tasks.rows[0]!.title).toBe('Renamed')
  })
})

describe('kick-create drafts', () => {
  it('reuses one intact draft per actor, keeps it off the board, and promotes on a real title', async () => {
    const { db, tasks, activity } = work()
    const { app } = makeApp({ containers: GATEWAY }, {}, db)
    const headers = { 'X-Portta-Actor': 'fabio', 'X-Portta-Actor-Kind': 'human' }
    const first = await post(app, '/api/projects/produto/tasks', { title: 'New task', draft: true }, headers)
    expect(first.status).toBe(201)
    const draft = await json(first)
    expect(draft).toMatchObject({ title: 'New task', draft: true, status: 'backlog' })
    expect(activity.rows).toEqual([])
    expect((await json(await app.request('/api/projects/produto/tasks'))).tasks).toEqual([])
    expect((await json(await app.request('/api/projects/produto/tasks?draft=true'))).tasks).toHaveLength(1)
    expect((await json(await app.request('/api/projects/produto/tasks/next'))).task).toBeNull()

    const reused = await post(app, '/api/projects/produto/tasks', { title: 'New task', draft: true }, headers)
    expect(reused.status).toBe(200)
    expect((await json(reused)).id).toBe(draft.id)
    expect(tasks.rows.filter((row) => row.draft)).toHaveLength(1)

    const promoted = await json(await app.request(`/api/tasks/${draft.id}`, {
      method: 'PATCH', body: JSON.stringify({ title: 'Configurar API' }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost', 'X-Portta-Actor': 'fabio' },
    }))
    expect(promoted).toMatchObject({ title: 'Configurar API', draft: false })
    expect(activity.rows[0]).toMatchObject({ kind: 'task.created', taskId: draft.id })
    expect((await json(await app.request('/api/projects/produto/tasks'))).tasks).toHaveLength(1)
  })

  it('sweeps an untouched draft older than a day, stores a due date, and refuses a parent cycle', async () => {
    const { db, tasks } = work()
    tasks.seed({
      projectId: 'w1', title: 'New task', draft: true, createdBy: 'fabio',
      updatedAt: new Date('2020-01-01T00:00:00Z'),
    })
    const parent = tasks.seed({ projectId: 'w1', title: 'Parent' })
    const child = tasks.seed({ projectId: 'w1', title: 'Child', parentId: parent.id })
    const { app } = makeApp({ containers: GATEWAY }, {}, db)
    const created = await json(await post(app, '/api/projects/produto/tasks', {
      title: 'New task', draft: true, dueAt: 1_735_689_600,
    }, { 'X-Portta-Actor': 'ada' }))
    expect(created.dueAt).toBe(1_735_689_600)
    expect(tasks.rows.some((row) => row.createdBy === 'fabio' && row.draft)).toBe(false)

    const cycled = await app.request(`/api/tasks/${parent.id}`, {
      method: 'PATCH', body: JSON.stringify({ parentId: child.id }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
    })
    expect(cycled.status).toBe(400)
  })

  it('imports a document by source_key and exports the same keys', async () => {
    const { db } = work()
    const { app } = makeApp({ containers: GATEWAY }, {}, db)
    const document = {
      schemaVersion: 1,
      project: { slug: 'produto', name: 'Produto' },
      tasks: [{
        key: 'shop-auth', title: 'Auth', environment: 'alpha',
        comments: [{ key: 'auth-note', actor: 'fabio', body: 'start here' }],
        subtasks: [{ key: 'shop-auth-ui', title: 'UI' }],
      }],
    }
    const first = await json(await post(app, '/api/projects/produto/tasks/import', document))
    expect(first).toMatchObject({ created: 2, updated: 0 })
    expect(first.tasks.map((task: { title: string }) => task.title)).toEqual(['Auth', 'UI'])
    expect(first.tasks[0].notes[0]).toMatchObject({ body: 'start here' })

    document.tasks[0]!.title = 'Auth (renamed)'
    const second = await json(await post(app, '/api/projects/produto/tasks/import', document))
    expect(second).toMatchObject({ created: 0, updated: 2 })
    expect(second.tasks[0].title).toBe('Auth (renamed)')

    const exported = await json(await app.request('/api/projects/produto/tasks/export'))
    expect(exported.tasks.map((task: { key: string }) => task.key)).toEqual(['shop-auth'])
    expect(exported.tasks[0].subtasks[0].key).toBe('shop-auth-ui')
  })
})

describe('refusals', () => {
  it('refuses every write in read-only mode, and leaves the reads', async () => {
    const { db, tasks } = work()
    const task = tasks.seed({ projectId: 'w1', title: 't' })
    const { app } = makeApp({ containers: GATEWAY }, { readOnly: true }, db)
    expect((await app.request(`/api/tasks/${task.id}`)).status).toBe(200)
    for (const path of [`/api/tasks/${task.id}/start`, `/api/tasks/${task.id}/notes`, '/api/projects/produto/tasks']) {
      expect((await post(app, path, { title: 'x', body: 'x' })).status).toBe(403)
    }
  })
})
