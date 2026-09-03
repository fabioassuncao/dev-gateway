import { describe, expect, it } from 'vitest'
import type { StoredIssue } from '../../src/server/db/github.ts'
import type { Database } from '../../src/server/db/index.ts'
import type { GitHubIntegration } from '../../src/server/integrations/github/index.ts'
import { GATEWAY } from './fixtures.ts'
import { makeApp, post } from './helpers.ts'
import {
  finishPlan,
  isBlockedBySubtasks,
  nextTask,
  parseTaskRef,
  priorityRank,
  readActor,
  startPlan,
  subtaskTree,
} from '../../src/server/core/tasks.ts'

function task(overrides: Partial<StoredIssue> & { id: string }): StoredIssue {
  return {
    githubId: 1, nodeId: 'n', repositoryId: 'r1', repository: 'acme/api', number: 1,
    title: 't', body: null, state: 'open', stateReason: null, issueType: null,
    workflowStatus: 'ready', priority: null, metadataSource: 'labels',
    labels: [], assignees: [], milestone: null, htmlUrl: 'https://github.com/acme/api/issues/1',
    isPullRequest: false, githubUpdatedAt: new Date('2026-01-01T00:00:00Z'), syncedAt: new Date(),
    ...overrides,
  } as StoredIssue
}

describe('parseTaskRef', () => {
  // The coordinate is what a human or an agent already has: it is in the branch
  // name, the commit message and the URL. Requiring the projected id would mean
  // a lookup before every call.
  it('reads owner/repo#number', () => {
    expect(parseTaskRef('acme/api#42')).toEqual({ kind: 'coordinate', repository: 'acme/api', number: 42 })
    expect(parseTaskRef('acme-corp/my.repo#7')).toEqual({ kind: 'coordinate', repository: 'acme-corp/my.repo', number: 7 })
  })

  it('reads it URL-encoded, which is how it arrives in a path', () => {
    expect(parseTaskRef(encodeURIComponent('acme/api#42'))).toEqual({ kind: 'coordinate', repository: 'acme/api', number: 42 })
  })

  it('treats anything else as a projected id, rather than guessing a format the database owns', () => {
    expect(parseTaskRef('a1b2c3')).toEqual({ kind: 'id', id: 'a1b2c3' })
  })

  it('refuses what cannot be either', () => {
    expect(parseTaskRef('')).toBeNull()
    expect(parseTaskRef('   ')).toBeNull()
    expect(parseTaskRef('acme/api#0')).toBeNull()
    expect(parseTaskRef('acme/api#-1')).toEqual({ kind: 'id', id: 'acme/api#-1' })
  })
})

describe('priorityRank', () => {
  it('puts urgent first and nothing last', () => {
    expect(priorityRank('urgent')).toBeLessThan(priorityRank('high'))
    expect(priorityRank('high')).toBeLessThan(priorityRank('medium'))
    expect(priorityRank('medium')).toBeLessThan(priorityRank('low'))
    // Unprioritised is not the same as low: nobody has triaged it.
    expect(priorityRank('low')).toBeLessThan(priorityRank(null))
    expect(priorityRank('nonsense')).toBe(priorityRank(null))
  })
})

describe('isBlockedBySubtasks', () => {
  // A parent whose sub-issues are open is not work: taking it means doing the
  // children, and the children are the tasks.
  it('blocks a parent with an open child', () => {
    const parent = task({ id: 'p' })
    const child = task({ id: 'c', state: 'open' })
    expect(isBlockedBySubtasks(parent, [parent, child], [{ parentId: 'p', childId: 'c' }])).toBe(true)
  })

  it('releases it once every child is closed', () => {
    const parent = task({ id: 'p' })
    const child = task({ id: 'c', state: 'closed' })
    expect(isBlockedBySubtasks(parent, [parent, child], [{ parentId: 'p', childId: 'c' }])).toBe(false)
  })

  it('does not block a task with no children', () => {
    const alone = task({ id: 'a' })
    expect(isBlockedBySubtasks(alone, [alone], [])).toBe(false)
  })

  // A child outside the projection is not evidence the parent is ready; it is
  // evidence the projection is incomplete.
  it('blocks when a child is not in the projection at all', () => {
    const parent = task({ id: 'p' })
    expect(isBlockedBySubtasks(parent, [parent], [{ parentId: 'p', childId: 'missing' }])).toBe(true)
  })
})

describe('nextTask', () => {
  it('offers nothing when there is nothing ready', () => {
    expect(nextTask([], [])).toBeNull()
    expect(nextTask([task({ id: 'a', workflowStatus: 'backlog' })], [])).toBeNull()
    expect(nextTask([task({ id: 'a', workflowStatus: 'in_progress' })], [])).toBeNull()
  })

  it('never offers a closed task or a pull request', () => {
    expect(nextTask([task({ id: 'a', state: 'closed' })], [])).toBeNull()
    expect(nextTask([task({ id: 'a', isPullRequest: true })], [])).toBeNull()
  })

  it('takes the highest priority first', () => {
    const low = task({ id: 'low', priority: 'low' })
    const urgent = task({ id: 'urgent', priority: 'urgent' })
    const none = task({ id: 'none' })
    expect(nextTask([low, none, urgent], [])?.id).toBe('urgent')
  })

  // A task nobody picks up should rise, not starve.
  it('breaks a priority tie by how long it has waited', () => {
    const older = task({ id: 'older', priority: 'high', githubUpdatedAt: new Date('2026-01-01T00:00:00Z') })
    const newer = task({ id: 'newer', priority: 'high', githubUpdatedAt: new Date('2026-06-01T00:00:00Z') })
    expect(nextTask([newer, older], [])?.id).toBe('older')
  })

  it('is deterministic on a complete tie, so two calls answer the same', () => {
    const a = task({ id: 'aaa' })
    const b = task({ id: 'bbb' })
    expect(nextTask([b, a], [])?.id).toBe('aaa')
    expect(nextTask([a, b], [])?.id).toBe('aaa')
  })

  // Handing out somebody else's task is how two agents end up on one branch.
  it('skips a task assigned to somebody else, and offers one assigned to the caller', () => {
    const theirs = task({ id: 'theirs', assignees: ['someone'] })
    const mine = task({ id: 'mine', assignees: ['me'] })
    expect(nextTask([theirs], [], { actor: 'me' })).toBeNull()
    expect(nextTask([theirs, mine], [], { actor: 'me' })?.id).toBe('mine')
    // With no actor, only unassigned work is on offer.
    expect(nextTask([theirs, mine], [])).toBeNull()
  })

  it('skips a parent whose sub-issues are unfinished, and offers the child', () => {
    const parent = task({ id: 'p', priority: 'urgent' })
    const child = task({ id: 'c', priority: 'low' })
    const links = [{ parentId: 'p', childId: 'c' }]
    expect(nextTask([parent, child], links)?.id).toBe('c')
  })
})

describe('subtaskTree', () => {
  it('builds the graph under one task', () => {
    const issues = [task({ id: 'p' }), task({ id: 'c1' }), task({ id: 'c2' }), task({ id: 'g' })]
    const links = [
      { parentId: 'p', childId: 'c1' },
      { parentId: 'p', childId: 'c2' },
      { parentId: 'c1', childId: 'g' },
    ]
    const tree = subtaskTree('p', issues, links)
    expect(tree.map((node) => node.task.id)).toEqual(['c1', 'c2'])
    expect(tree[0]?.children.map((node) => node.task.id)).toEqual(['g'])
    expect(tree[1]?.children).toEqual([])
  })

  // The database refuses a one-step cycle; a longer one must produce a shorter
  // tree rather than a hang.
  it('terminates on a cycle', () => {
    const issues = [task({ id: 'a' }), task({ id: 'b' })]
    const links = [{ parentId: 'a', childId: 'b' }, { parentId: 'b', childId: 'a' }]
    expect(() => subtaskTree('a', issues, links)).not.toThrow()
    expect(subtaskTree('a', issues, links)[0]?.task.id).toBe('b')
  })

  it('skips a child the projection does not hold', () => {
    const issues = [task({ id: 'p' })]
    expect(subtaskTree('p', issues, [{ parentId: 'p', childId: 'gone' }])).toEqual([])
  })
})

describe('the transition plans', () => {
  // Assigning is what makes `next_task` stop offering it to somebody else, so
  // it is part of starting rather than a separate call.
  it('start assigns the actor and moves to in_progress', () => {
    const plan = startPlan(task({ id: 'a' }), 'agent')
    expect(plan.status).toBe('in_progress')
    expect(plan.assignees).toEqual(['agent'])
    expect(plan.state).toBeNull()
  })

  it('start does not assign twice, and does not assign nobody', () => {
    expect(startPlan(task({ id: 'a', assignees: ['agent'] }), 'agent').assignees).toBeNull()
    expect(startPlan(task({ id: 'a' }), null).assignees).toBeNull()
  })

  it('start keeps existing assignees', () => {
    expect(startPlan(task({ id: 'a', assignees: ['someone'] }), 'agent').assignees).toEqual(['someone', 'agent'])
  })

  // Closing is only ever `finish`'s doing, and only when asked.
  it('finish moves to done, and closes only when asked', () => {
    expect(finishPlan(false)).toEqual({ status: 'done', state: null, assignees: null })
    expect(finishPlan(true)).toEqual({ status: 'done', state: 'closed', assignees: null })
  })
})

describe('readActor', () => {
  it('takes a plain identifier', () => {
    expect(readActor('claude-code')).toBe('claude-code')
    expect(readActor('  agent_1  ')).toBe('agent_1')
  })

  // It is logged, so it must not be able to carry a newline into the log or
  // anything that reads like structure.
  it('refuses anything that is not one', () => {
    expect(readActor(undefined)).toBeNull()
    expect(readActor('')).toBeNull()
    expect(readActor('has space')).toBeNull()
    expect(readActor('line\nbreak')).toBeNull()
    expect(readActor('x'.repeat(65))).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The endpoints
// ---------------------------------------------------------------------------

const NOW = new Date('2026-01-01T12:00:00Z')

function row(overrides: Record<string, unknown> = {}) {
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

function taskDatabase(rows = [row()], relationships: { parentId: string; childId: string; position: number }[] = [], repository: unknown = { id: 'r1', fullName: 'acme/api', installationId: 99 }) {
  return {
    status: () => ({ configured: true, available: true, reason: null, checkedAt: 0, migrations: [] }),
    environments: { find: async () => null, upsertSeen: async () => ({}), list: async () => [] },
    settings: { listAllEnvironment: async () => [], listAllService: async () => [] },
    projects: {
      find: async (slug: string) => (slug === 'produto' ? { id: 'w1', slug, name: 'Produto' } : null),
      listRepositories: async () => [{ projectId: 'w1', repositoryId: 'r1', fullName: 'acme/api' }],
      list: async () => [], listEnvironments: async () => [],
    },
    github: {
      listIssues: async (filter: { repositoryIds?: string[] }) =>
        rows.filter((entry) => filter.repositoryIds === undefined || filter.repositoryIds.includes(entry.repositoryId)),
      findIssue: async (id: string) => rows.find((entry) => entry.id === id) ?? null,
      listRelationships: async () => relationships,
      findRepository: async () => repository,
      listRepositories: async () => [],
      listIssueEnvironments: async () => [],
      upsertIssue: async () => undefined,
    },
  } as unknown as Database
}

/** A GitHub integration that confirms every write, and records what was sent. */
function fakeGitHub(sent: Record<string, unknown>[] = []) {
  const client = {
    patchAsInstallation: async (_id: number, _path: string, patch: Record<string, unknown>) => {
      sent.push(patch)
      return { data: { id: 1, node_id: 'I_1', number: 123, title: 't', body: null, state: 'open', state_reason: null, labels: [], assignees: [], milestone: null, html_url: 'https://x', updated_at: NOW.toISOString() }, next: null }
    },
    postAsInstallation: async (_id: number, path: string, body: Record<string, unknown>) => {
      sent.push({ path, ...body })
      return { data: { id: 55, html_url: 'https://github.com/acme/api/issues/123#issuecomment-55', body: String(body['body']), created_at: NOW.toISOString() }, next: null }
    },
  }
  return {
    status: () => ({ configured: true, available: true, reason: null, appId: 1, checkedAt: 0 }),
    require: () => client,
    check: async () => ({ available: true }),
    keyIsPrivate: () => true,
  } as unknown as GitHubIntegration
}

describe('the task endpoints', () => {
  it('lists a Project’s tasks', async () => {
    const { app } = makeApp({ containers: GATEWAY }, {}, taskDatabase(), fakeGitHub())
    const body = await (await app.request('/api/projects/produto/tasks')).json()
    expect(body.tasks).toHaveLength(1)
    expect(body.tasks[0]).toMatchObject({ repository: 'acme/api', number: 123, status: 'ready' })
  })

  it('offers the next task, and null when there is none', async () => {
    const { app } = makeApp({ containers: GATEWAY }, {}, taskDatabase(), fakeGitHub())
    const body = await (await app.request('/api/projects/produto/tasks/next')).json()
    expect(body.task).toMatchObject({ number: 123 })

    const { app: empty } = makeApp({ containers: GATEWAY }, {}, taskDatabase([row({ workflowStatus: 'backlog' })]), fakeGitHub())
    expect((await (await empty.request('/api/projects/produto/tasks/next')).json()).task).toBeNull()
  })

  // The coordinate is the point of the ref: something that read a branch name
  // can address a task without a lookup.
  it('addresses a task by owner/repo#number and by id', async () => {
    const { app } = makeApp({ containers: GATEWAY }, {}, taskDatabase(), fakeGitHub())
    for (const ref of [encodeURIComponent('acme/api#123'), '1']) {
      const response = await app.request(`/api/tasks/${ref}`)
      expect(response.status, ref).toBe(200)
      expect((await response.json()).number).toBe(123)
    }
  })

  // The projection is the authorisation boundary, and it is checked before any
  // request could leave the host.
  it('refuses a coordinate outside the projection, without asking GitHub', async () => {
    const sent: Record<string, unknown>[] = []
    const { app } = makeApp({ containers: GATEWAY }, {}, taskDatabase(), fakeGitHub(sent))
    const response = await app.request(`/api/tasks/${encodeURIComponent('evil/repo#1')}`)
    expect(response.status).toBe(404)
    expect(sent).toEqual([])
  })

  it('refuses a reference that is not one', async () => {
    const { app } = makeApp({ containers: GATEWAY }, {}, taskDatabase(), fakeGitHub())
    expect((await app.request('/api/tasks/%20')).status).toBe(400)
  })

  it('returns the sub-issue graph as a tree', async () => {
    const rows = [row(), row({ id: '2', number: 124, title: 'Sub' })]
    const db = taskDatabase(rows, [{ parentId: '1', childId: '2', position: 0 }])
    const { app } = makeApp({ containers: GATEWAY }, {}, db, fakeGitHub())
    const body = await (await app.request('/api/tasks/1/subtasks')).json()
    expect(body.subtasks).toHaveLength(1)
    expect(body.subtasks[0].task.number).toBe(124)
    expect(body.subtasks[0].children).toEqual([])
  })

  it('starts a task: one confirmed write that sets the status and assigns', async () => {
    const sent: Record<string, unknown>[] = []
    const { app } = makeApp({ containers: GATEWAY }, {}, taskDatabase(), fakeGitHub(sent))
    const response = await post(app, '/api/tasks/1/start', {}, { 'X-Portta-Actor': 'agent' })
    expect(response.status).toBe(200)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.['labels']).toContain('status:in-progress')
    expect(sent[0]?.['assignees']).toEqual(['agent'])
  })

  it('finishes a task, and closes it only when asked', async () => {
    const sent: Record<string, unknown>[] = []
    const { app } = makeApp({ containers: GATEWAY }, {}, taskDatabase(), fakeGitHub(sent))
    await post(app, '/api/tasks/1/finish', {})
    expect(sent[0]?.['state']).toBeUndefined()
    await post(app, '/api/tasks/1/finish', { close: true })
    expect(sent[1]?.['state']).toBe('closed')
  })

  it('validates a status against the workflow', async () => {
    const { app } = makeApp({ containers: GATEWAY }, {}, taskDatabase(), fakeGitHub())
    expect((await post(app, '/api/tasks/1/status', { status: 'review' })).status).toBe(200)
    expect((await post(app, '/api/tasks/1/status', { status: 'shipped' })).status).toBe(400)
  })

  // Write-through and never projected: no table, no sync path, no cache.
  it('comments straight to GitHub and returns what GitHub returned', async () => {
    const sent: Record<string, unknown>[] = []
    const { app } = makeApp({ containers: GATEWAY }, {}, taskDatabase(), fakeGitHub(sent))
    const response = await post(app, '/api/tasks/1/comments', { body: 'on it' })
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ id: 55, body: 'on it' })
    expect(sent[0]?.['path']).toBe('/repos/acme/api/issues/123/comments')
  })

  const WRITES: Array<[string, Record<string, unknown>]> = [
    ['/api/tasks/1/start', {}],
    ['/api/tasks/1/status', { status: 'review' }],
    ['/api/tasks/1/finish', {}],
    ['/api/tasks/1/comments', { body: 'x' }],
  ]

  it('refuses every write in read-only mode', async () => {
    const { app } = makeApp({ containers: GATEWAY }, { readOnly: true }, taskDatabase(), fakeGitHub())
    for (const [path, body] of WRITES) {
      expect((await post(app, path, body)).status, path).toBe(403)
    }
  })

  // 400 through OverrideRefused, which is exactly what PATCH /api/issues/:id
  // answers for the same refusal: the task verbs must not refuse differently
  // from the endpoint they are a vocabulary over.
  //
  // "There is no App" is the answer to give, not "your body has an extra key",
  // so this is refused before the body is parsed.
  it('refuses every write with no App configured', async () => {
    const { app } = makeApp({ containers: GATEWAY }, {}, taskDatabase(), null)
    for (const [path, body] of WRITES) {
      const response = await post(app, path, body)
      expect(response.status, path).toBe(400)
      expect((await response.json()).error, path).toContain('the GitHub App is not configured')
    }
  })

  it('refuses a write for a repository the installation no longer grants', async () => {
    const sent: Record<string, unknown>[] = []
    const db = taskDatabase([row()], [], null)
    const { app } = makeApp({ containers: GATEWAY }, {}, db, fakeGitHub(sent))
    for (const [path, body] of WRITES) {
      const response = await post(app, path, body)
      expect(response.status, path).toBe(400)
      expect((await response.json()).error, path).toContain('not a repository this gateway was granted')
    }
    // The point of the boundary: nothing left the host.
    expect(sent).toEqual([])
  })

  // The actor answers "did I do that or did an agent". GitHub sees the App
  // either way, so it must never be forwarded.
  it('never forwards the actor to GitHub', async () => {
    const sent: Record<string, unknown>[] = []
    const { app } = makeApp({ containers: GATEWAY }, {}, taskDatabase(), fakeGitHub(sent))
    await post(app, '/api/tasks/1/start', {}, { 'X-Portta-Actor': 'agent' })
    expect(JSON.stringify(sent)).not.toContain('X-Portta-Actor')
    expect(sent[0]).not.toHaveProperty('actor')
  })
})
