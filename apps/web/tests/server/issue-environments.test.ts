import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { makeApp } from './helpers.ts'
import { GATEWAY, PROJECT_A } from './fixtures.ts'
import {
  inferIssueLink,
  issueFromBranch,
  issueFromNamespace,
  parseIssueLabel,
} from '../../src/server/core/issue-link.ts'
import { environmentsFor, resolveLinks } from '../../src/server/core/issue-environments.ts'
import { buildSnapshot } from '../../src/server/core/inventory.ts'
import { fakeDocker, testConfig } from './helpers.ts'
import type { Database } from '../../src/server/db/index.ts'
import type { Issue, Project } from '../../src/shared/types.ts'

describe('the link schema', () => {
  const migration = readFileSync(new URL('../../migrations/0005_issue_environments.sql', import.meta.url), 'utf8')

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

describe('resolving links', () => {
  it('links through the label the project declared', async () => {
    const snapshot = await snapshotWith({ 'portta.issue': '#182' })
    const links = resolveLinks(snapshot, [storedIssue()], [])
    expect(links.get('alpha')).toMatchObject({ issueId: '1', source: 'label' })
  })

  it('links through the branch when there is no label', async () => {
    const snapshot = await snapshotWith()
    const links = resolveLinks(snapshot, [storedIssue()], [], new Map([['alpha', 'fix/182-tcp-proxy']]))
    expect(links.get('alpha')).toMatchObject({ issueId: '1', source: 'branch' })
    expect(links.get('alpha')!.reason).toContain('fix/182-tcp-proxy')
  })

  it('lets a manual link win over an inferred one', async () => {
    const snapshot = await snapshotWith({ 'portta.issue': '#182' })
    const links = resolveLinks(
      snapshot,
      [storedIssue(), storedIssue({ id: '2', githubId: 2, number: 190 })],
      [{ issueId: '2', composeProject: 'alpha', branch: null }],
    )
    expect(links.get('alpha')).toMatchObject({ issueId: '2', source: 'manual' })
  })

  it('links nothing when a bare number matches two repositories', async () => {
    // No portta.repo label, so the coordinate carries no repository and
    // #182 could mean either issue. An ambiguous match links nothing.
    const containers = PROJECT_A.map((container) => ({
      ...container,
      labels: { ...container.labels, 'portta.issue': '182' },
    }))
    const docker = fakeDocker({ containers: [...GATEWAY, ...containers] })
    const snapshot = await buildSnapshot(docker.client, testConfig())

    const links = resolveLinks(
      snapshot,
      [storedIssue(), storedIssue({ id: '2', githubId: 2, repository: 'acme/other' })],
      [],
    )
    expect(links.has('alpha')).toBe(false)
  })

  it('links when a bare number is unambiguous against the environment repository', async () => {
    const snapshot = await snapshotWith({ 'portta.issue': '182' })
    const links = resolveLinks(
      snapshot,
      [storedIssue(), storedIssue({ id: '2', githubId: 2, repository: 'acme/other' })],
      [],
    )
    expect(links.get('alpha')).toMatchObject({ issueId: '1', source: 'label' })
  })

  it('links nothing when the issue is not projected', async () => {
    const snapshot = await snapshotWith({ 'portta.issue': '#999' })
    expect(resolveLinks(snapshot, [storedIssue()], []).has('alpha')).toBe(false)
  })

  it('describes an environment with a way into its logs', async () => {
    const snapshot = await snapshotWith({ 'portta.issue': '#182' })
    const links = resolveLinks(snapshot, [storedIssue()], [])
    const environments = environmentsFor('1', snapshot, links)

    expect(environments).toHaveLength(1)
    expect(environments[0]).toMatchObject({
      project: 'alpha',
      source: 'label',
      running: true,
      panelUrl: '#/projects/alpha',
      logsUrl: '#/projects/alpha/logs',
    })
    expect(environments[0]!.urls.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// The endpoints
// ---------------------------------------------------------------------------

function linkDatabase(rows = [storedIssue()], manual: { issueId: string; composeProject: string; branch: string | null }[] = []) {
  const store = { manual: [...manual] }
  const db = {
    status: () => ({ configured: true, available: true, reason: null, checkedAt: 0, migrations: [] }),
    projects: { find: async () => null, upsertSeen: async () => ({}), list: async () => [] },
    settings: { listAllProject: async () => [], listAllService: async () => [] },
    workspaces: { find: async () => null, listRepositories: async () => [], listEnvironments: async () => [] },
    github: {
      listIssues: async () => rows,
      findIssue: async (id: string) => rows.find((row) => row.id === id) ?? null,
      listRelationships: async () => [],
      findRepository: async () => null,
      listRepositories: async () => [],
      listIssueEnvironments: async () =>
        store.manual.map((entry) => ({ ...entry, source: 'manual', worktreePath: null, linkedAt: NOW })),
      setIssueEnvironments: async (issueId: string, links: { composeProject: string; branch: string | null }[]) => {
        store.manual = links.map((link) => ({ issueId, ...link }))
      },
    },
  }
  return { db: db as unknown as Database, store }
}

function app(labels: Record<string, string> = {}, rows = [storedIssue()]) {
  const containers = PROJECT_A.map((container) => ({
    ...container,
    labels: { ...container.labels, 'portta.repo': 'acme/alpha', ...labels },
  }))
  const { db, store } = linkDatabase(rows)
  return { ...makeApp({ containers: [...GATEWAY, ...containers] }, {}, db), store }
}

describe('the issue endpoint', () => {
  it('carries the environments the issue is being worked in', async () => {
    const instance = app({ 'portta.issue': '#182' })
    const issue = (await (await instance.app.request('/api/issues/1')).json()) as Issue

    expect(issue.environments).toHaveLength(1)
    expect(issue.environments[0]).toMatchObject({
      project: 'alpha',
      source: 'label',
      logsUrl: '#/projects/alpha/logs',
    })
  })

  it('carries an empty list when nothing is linked', async () => {
    const instance = app()
    const issue = (await (await instance.app.request('/api/issues/1')).json()) as Issue
    expect(issue.environments).toEqual([])
  })

  it('links by hand, and the manual link wins', async () => {
    const instance = app()
    const response = await instance.app.request('/api/issues/1/environments', {
      method: 'PUT',
      body: JSON.stringify({ environments: ['alpha'] }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
    })
    expect(response.status).toBe(200)
    const issue = (await response.json()) as Issue
    expect(issue.environments[0]).toMatchObject({ project: 'alpha', source: 'manual' })
  })

  it('refuses to link an environment that is not running', async () => {
    const instance = app()
    const response = await instance.app.request('/api/issues/1/environments', {
      method: 'PUT',
      body: JSON.stringify({ environments: ['ghost'] }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
    })
    expect(response.status).toBe(400)
  })

  it('starts, stops and removes nothing when linking', async () => {
    const instance = app()
    await instance.app.request('/api/issues/1/environments', {
      method: 'PUT',
      body: JSON.stringify({ environments: ['alpha'] }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
    })
    expect(instance.docker.removed).toEqual([])
    expect(instance.docker.calls.filter((call) => ['start', 'stop', 'restart', 'remove'].includes(call.method))).toEqual([])
    expect(instance.docker.created).toEqual([])
  })
})

describe('the project endpoint', () => {
  it('gains the issue this environment belongs to', async () => {
    const instance = app({ 'portta.issue': '#182' })
    const project = (await (await instance.app.request('/api/projects/alpha')).json()) as Project

    expect(project.issue).toMatchObject({
      repository: 'acme/alpha',
      number: 182,
      title: 'Proxy TCP perde conexão',
      source: 'label',
      panelUrl: '#/issues/1',
    })
  })

  it('is unchanged when nothing links, so no client breaks', async () => {
    const instance = app()
    const project = (await (await instance.app.request('/api/projects/alpha')).json()) as Project
    expect(project.issue).toBeUndefined()
  })

  it('is unchanged with no database at all', async () => {
    const { app: bare } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] })
    const project = (await (await bare.request('/api/projects/alpha')).json()) as Project
    expect(project.issue).toBeUndefined()
    expect(project.name).toBe('alpha')
  })
})
