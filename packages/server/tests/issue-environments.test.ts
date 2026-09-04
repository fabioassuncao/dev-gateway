import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { makeApp } from './helpers.ts'
import { GATEWAY, PROJECT_A } from './fixtures.ts'
import {
  inferIssueLink,
  issueFromBranch,
  issueFromNamespace,
  parseIssueLabel,
} from '../src/services/issue-link.ts'
import { environmentsFor, issueLinksFrom } from '../src/services/issue-environments.ts'
import { resolveTaskLinks } from '../src/services/task-environments.ts'
import { fakeActivity, fakeSessions, fakeTasks, type FakeTasks } from './fake-work.ts'
import { buildSnapshot } from '../src/services/inventory.ts'
import { fakeDocker, testConfig } from './helpers.ts'
import type { Database } from '../src/db/index.ts'
import type { Environment, Issue } from 'portta-contracts'

describe('the link schema', () => {
  const migration = readFileSync(new URL('../migrations/0005_issue_environments.sql', import.meta.url), 'utf8')

  it('gives an issue many environments and an environment one issue', () => {
    expect(migration).toContain('PRIMARY KEY (issue_id, project_id)')
    expect(migration).toContain('issue_environments_one_issue_per_env')
  })

  it('keeps the worktree model open without building it', () => {
    expect(migration).toContain('worktree_path TEXT')
  })

  it('records why a link exists', () => {
    expect(migration).toContain("source IN ('manual', 'label', 'branch', 'namespace')")
  })

  it('creates no agent_runs table on speculation', () => {
    expect(migration).not.toMatch(/CREATE TABLE agent_runs/)
  })
})

describe('reading an issue out of a convention', () => {
  it('parses a qualified and a bare label', () => {
    expect(parseIssueLabel('acme/api#182')).toEqual({ repository: 'acme/api', number: 182 })
    expect(parseIssueLabel('#182')).toEqual({ repository: null, number: 182 })
    expect(parseIssueLabel('182')).toEqual({ repository: null, number: 182 })
    expect(parseIssueLabel('nonsense')).toBeNull()
    expect(parseIssueLabel(null)).toBeNull()
  })

  it('reads the documented branch shapes and nothing else', () => {
    expect(issueFromBranch('fix/182-tcp-proxy')).toBe(182)
    expect(issueFromBranch('feat/190-invoices')).toBe(190)
    expect(issueFromBranch('issue-182')).toBe(182)
    expect(issueFromBranch('182-tcp-proxy')).toBe(182)
    expect(issueFromBranch('main')).toBeNull()
    expect(issueFromBranch('release/2024-01')).toBeNull()
  })

  it('reads what portta namespace produces', () => {
    expect(issueFromNamespace('base-empresarial-issue182')).toBe(182)
    expect(issueFromNamespace('base-empresarial')).toBeNull()
  })
})

describe('inference precedence', () => {
  const base = {
    name: 'alpha-issue182',
    namespace: 'alpha-issue182',
    issueLabel: null,
    branch: null,
    repository: 'acme/alpha',
  }

  it('honours the label the project declared, over everything else', () => {
    expect(inferIssueLink({ ...base, issueLabel: 'acme/api#7', branch: 'fix/182-x' })).toEqual({
      issue: { repository: 'acme/api', number: 7 },
      source: 'label',
      branch: 'fix/182-x',
    })
  })

  it('falls back to the branch', () => {
    expect(inferIssueLink({ ...base, namespace: null, name: 'alpha', branch: 'fix/182-tcp-proxy' })).toEqual({
      issue: { repository: 'acme/alpha', number: 182 },
      source: 'branch',
      branch: 'fix/182-tcp-proxy',
    })
  })

  it('falls back to the namespace last', () => {
    expect(inferIssueLink(base)).toEqual({
      issue: { repository: 'acme/alpha', number: 182 },
      source: 'namespace',
      branch: null,
    })
  })

  it('links nothing when the repository is unknown', () => {
    expect(inferIssueLink({ ...base, repository: null })).toBeNull()
  })

  it('links nothing when there is no convention to read', () => {
    expect(
      inferIssueLink({ name: 'alpha', namespace: null, issueLabel: null, branch: 'main', repository: 'acme/alpha' }),
    ).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The join
// ---------------------------------------------------------------------------

const NOW = new Date('2026-01-01T12:00:00Z')

function storedIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: '1', githubId: 1, nodeId: 'I_1', repositoryId: 'r1', repository: 'acme/alpha',
    number: 182, title: 'Proxy TCP perde conexão', body: null, state: 'open',
    stateReason: null, issueType: 'Bug', workflowStatus: 'in_progress', priority: 'high',
    metadataSource: 'labels', labels: [], assignees: [], milestone: null,
    htmlUrl: 'https://github.com/acme/alpha/issues/182',
    isPullRequest: false, githubUpdatedAt: NOW, syncedAt: NOW,
    ...overrides,
  }
}

async function snapshotWith(labels: Record<string, string> = {}) {
  const containers = PROJECT_A.map((container) => ({
    ...container,
    labels: { ...container.labels, 'portta.repo': 'acme/alpha', ...labels },
  }))
  const docker = fakeDocker({ containers: [...GATEWAY, ...containers] })
  return buildSnapshot(docker.client, testConfig())
}

/**
 * An issue reaches an environment through the task bound to it. `resolve`
 * stands in for the two halves of the request: task links resolved, then
 * narrowed to the tasks that are bound.
 */
function resolve(
  snapshot: Awaited<ReturnType<typeof snapshotWith>>,
  issues: ReturnType<typeof storedIssue>[],
  stored: { taskId: string; composeProject: string; branch: string | null }[] = [],
  branches = new Map<string, string | null>(),
) {
  const tasks = issues.map((issue) => ({ id: `t${issue.id}` }))
  const bindings = issues.map((issue) => ({ taskId: `t${issue.id}`, githubIssueId: issue.id }))
  const resolved = resolveTaskLinks({
    snapshot, tasks, stored: stored.map((row) => ({ ...row, source: 'manual' as const })), bindings, issues, branches,
  })
  return issueLinksFrom(resolved, bindings)
}

describe('resolving links', () => {
  it('links through the label the project declared', async () => {
    const snapshot = await snapshotWith({ 'portta.issue': '#182' })
    expect(resolve(snapshot, [storedIssue()]).get('alpha')).toMatchObject({ issueId: '1', taskId: 't1', source: 'label' })
  })

  it('links through the branch when there is no label', async () => {
    const snapshot = await snapshotWith()
    const links = resolve(snapshot, [storedIssue()], [], new Map([['alpha', 'fix/182-tcp-proxy']]))
    expect(links.get('alpha')).toMatchObject({ issueId: '1', source: 'branch' })
    expect(links.get('alpha')!.reason).toContain('fix/182-tcp-proxy')
  })

  it('lets a manual link win over an inferred one', async () => {
    const snapshot = await snapshotWith({ 'portta.issue': '#182' })
    const links = resolve(snapshot, [storedIssue(), storedIssue({ id: '2', githubId: 2, number: 190 })], [{ taskId: 't2', composeProject: 'alpha', branch: null }])
    expect(links.get('alpha')).toMatchObject({ issueId: '2', source: 'manual' })
  })

  it('links nothing when a bare number matches two repositories', async () => {
    const containers = PROJECT_A.map((container) => ({ ...container, labels: { ...container.labels, 'portta.issue': '182' } }))
    const docker = fakeDocker({ containers: [...GATEWAY, ...containers] })
    const snapshot = await buildSnapshot(docker.client, testConfig())
    expect(resolve(snapshot, [storedIssue(), storedIssue({ id: '2', githubId: 2, repository: 'acme/other' })]).has('alpha')).toBe(false)
  })

  it('links when a bare number is unambiguous against the environment repository', async () => {
    const snapshot = await snapshotWith({ 'portta.issue': '182' })
    expect(resolve(snapshot, [storedIssue(), storedIssue({ id: '2', githubId: 2, repository: 'acme/other' })]).get('alpha')).toMatchObject({ issueId: '1', source: 'label' })
  })

  it('links nothing when the issue is not projected', async () => {
    const snapshot = await snapshotWith({ 'portta.issue': '#999' })
    expect(resolve(snapshot, [storedIssue()]).has('alpha')).toBe(false)
  })

  it('prefers the task’s own coordinate over the issue’s', async () => {
    const snapshot = await snapshotWith({ 'portta.issue': '#182', 'portta.task': '#7' })
    const resolved = resolveTaskLinks({ snapshot, tasks: [{ id: '7' }, { id: 't1' }], stored: [], bindings: [{ taskId: 't1', githubIssueId: '1' }], issues: [storedIssue()], branches: new Map() })
    expect(resolved.get('alpha')).toMatchObject({ taskId: '7', source: 'label' })
  })

  it('describes an environment with a way into its logs', async () => {
    const snapshot = await snapshotWith({ 'portta.issue': '#182' })
    const environments = environmentsFor('1', snapshot, resolve(snapshot, [storedIssue()]))
    expect(environments).toHaveLength(1)
    expect(environments[0]).toMatchObject({ project: 'alpha', source: 'label', running: true, panelUrl: '#/environments/alpha', logsUrl: '#/environments/alpha/logs' })
    expect(environments[0]!.urls.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// The endpoints
// ---------------------------------------------------------------------------

function linkDatabase(rows = [storedIssue()]): { db: Database; tasks: FakeTasks } {
  const tasks = fakeTasks()
  const db = {
    status: () => ({ configured: true, available: true, reason: null, checkedAt: 0, migrations: [] }),
    environments: { find: async (name: string) => (name === 'alpha' ? { id: 'e1', composeProject: 'alpha' } : null), upsertSeen: async () => ({}), list: async () => [{ id: 'e1', composeProject: 'alpha' }] },
    settings: { listAllEnvironment: async () => [], listAllService: async () => [], getGlobal: async () => null },
    projects: { find: async () => null, list: async () => [{ id: 'w1', slug: 'produto', name: 'Produto' }], listEnvironments: async () => [] },
    repositories: { list: async () => [], find: async () => null, findByGitHub: async () => null },
    github: {
      listIssues: async () => rows,
      findIssue: async (id: string) => rows.find((row) => row.id === id) ?? null,
      findIssueByNumber: async (repositoryId: string, number: number) => rows.find((row) => row.repositoryId === repositoryId && row.number === number) ?? null,
      listRelationships: async () => [],
      findRepository: async (fullName: string) => (fullName === 'acme/alpha' ? { id: 'r1', fullName, installationId: 1 } : null),
      listRepositories: async () => [],
    },
    tasks, sessions: fakeSessions(), activity: fakeActivity(),
  }
  return { db: db as unknown as Database, tasks }
}

function app(labels: Record<string, string> = {}, rows = [storedIssue()]) {
  const containers = PROJECT_A.map((container) => ({
    ...container,
    labels: { ...container.labels, 'portta.repo': 'acme/alpha', ...labels },
  }))
  const { db, tasks } = linkDatabase(rows)
  // Every projected issue is bound to a task, as the migration would have left it.
  for (const row of rows) {
    const task = tasks.seed({ projectId: 'w1', title: row.title, status: 'in_progress' })
    tasks.links.push({ taskId: task.id, githubIssueId: row.id, syncState: 'synced', lastSyncedAt: NOW, lastError: null, localUpdatedAt: NOW, remoteUpdatedAt: NOW })
  }
  return { ...makeApp({ containers: [...GATEWAY, ...containers] }, {}, db), tasks }
}

describe('the issue endpoint', () => {
  it('carries the environments the issue is being worked in', async () => {
    const instance = app({ 'portta.issue': '#182' })
    const issue = (await (await instance.app.request('/api/issues/1')).json()) as Issue
    expect(issue.environments).toHaveLength(1)
    expect(issue.environments[0]).toMatchObject({ project: 'alpha', source: 'label', logsUrl: '#/environments/alpha/logs' })
  })

  it('carries an empty list when nothing is linked', async () => {
    const instance = app()
    const issue = (await (await instance.app.request('/api/issues/1')).json()) as Issue
    expect(issue.environments).toEqual([])
  })

  it('links by hand through the task, and the manual link wins', async () => {
    const instance = app()
    const taskId = instance.tasks.rows[0]!.id
    const response = await instance.app.request(`/api/tasks/${taskId}/environments`, {
      method: 'PUT', body: JSON.stringify({ environments: ['alpha'] }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
    })
    expect(response.status).toBe(200)
    const issue = (await (await instance.app.request('/api/issues/1')).json()) as Issue
    expect(issue.environments[0]).toMatchObject({ project: 'alpha', source: 'manual' })
    expect(instance.docker.removed).toEqual([])
    expect(instance.docker.calls.filter((call) => ['start', 'stop', 'restart', 'remove'].includes(call.method))).toEqual([])
  })

  it('no longer links an issue directly: the task is the thing an environment runs for', async () => {
    const instance = app()
    const response = await instance.app.request('/api/issues/1/environments', {
      method: 'PUT', body: JSON.stringify({ environments: ['alpha'] }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
    })
    expect(response.status).toBe(404)
  })
})

describe('the environment endpoint', () => {
  it('gains the task this environment runs for, and the issue it is bound to', async () => {
    const instance = app({ 'portta.issue': '#182' })
    const project = (await (await instance.app.request('/api/environments/alpha')).json()) as Environment
    expect(project.task).toMatchObject({ title: 'Proxy TCP perde conexão', status: 'in_progress', source: 'label', github: { repository: 'acme/alpha', number: 182 } })
    expect(project.issue).toMatchObject({ repository: 'acme/alpha', number: 182, source: 'label', panelUrl: '#/issues/1' })
  })

  it('is unchanged when nothing links, so no client breaks', async () => {
    const instance = app()
    const project = (await (await instance.app.request('/api/environments/alpha')).json()) as Environment
    expect(project.issue).toBeUndefined()
    expect(project.task).toBeUndefined()
  })

  it('is unchanged with no database at all', async () => {
    const { app: bare } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] })
    const project = (await (await bare.request('/api/environments/alpha')).json()) as Environment
    expect(project.issue).toBeUndefined()
    expect(project.name).toBe('alpha')
  })
})
