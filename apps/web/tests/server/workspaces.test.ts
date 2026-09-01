import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { del, makeApp, post } from './helpers.ts'
import { GATEWAY, PROJECT_A, PROJECT_B } from './fixtures.ts'
import {
  repositoryCoordinate,
  resolveAdoption,
  type WorkspaceCoordinates,
} from '../../src/server/core/adoption.ts'
import type { Database } from '../../src/server/db/index.ts'
import type { Workspace } from '../../src/shared/types.ts'

describe('the workspace schema', () => {
  const migration = readFileSync(new URL('../../migrations/0003_workspaces.sql', import.meta.url), 'utf8')

  it('keeps the decision and the observation in separate tables', () => {
    expect(migration).toContain('CREATE TABLE workspaces')
    expect(migration).toContain('REFERENCES github_repositories(id)')
    expect(migration).toContain('REFERENCES projects(id)')
  })

  it('gives an environment at most one workspace', () => {
    expect(migration).toContain('workspace_environments_one_workspace_per_env')
    expect(migration).toContain('ON workspace_environments (project_id)')
  })

  it('records why an adoption exists', () => {
    expect(migration).toContain("source IN ('manual', 'label', 'repo-match')")
  })
})

describe('repository coordinates', () => {
  it('reads the same slug out of every remote shape', () => {
    expect(repositoryCoordinate('git@github.com:Acme/Alpha.git')).toBe('acme/alpha')
    expect(repositoryCoordinate('https://github.com/acme/alpha')).toBe('acme/alpha')
    expect(repositoryCoordinate('https://github.com/acme/alpha.git')).toBe('acme/alpha')
    expect(repositoryCoordinate(null)).toBeNull()
  })
})

const WORKSPACES: WorkspaceCoordinates[] = [
  { id: '1', slug: 'meu-produto', repositories: ['acme/alpha', 'acme/api'] },
  { id: '2', slug: 'outro', repositories: ['acme/beta'] },
]

describe('adoption precedence', () => {
  const project = { name: 'alpha', group: null, repo: null, repoUrl: null }

  it('adopts nothing when there is nothing to go on', () => {
    expect(resolveAdoption(project, WORKSPACES, new Map())).toBeNull()
  })

  it('honours the dev-gateway.project label the project declared', () => {
    expect(resolveAdoption({ ...project, group: 'meu-produto' }, WORKSPACES, new Map())).toEqual({
      workspaceId: '1',
      source: 'label',
    })
  })

  it('lets a manual mapping override the label', () => {
    expect(
      resolveAdoption({ ...project, group: 'meu-produto' }, WORKSPACES, new Map([['alpha', '2']])),
    ).toEqual({ workspaceId: '2', source: 'manual' })
  })

  it('matches on the repository when exactly one workspace owns it', () => {
    expect(
      resolveAdoption(
        { ...project, repoUrl: 'git@github.com:acme/alpha.git' },
        WORKSPACES,
        new Map(),
      ),
    ).toEqual({ workspaceId: '1', source: 'repo-match' })
  })

  it('adopts nothing when two workspaces own the same repository', () => {
    const ambiguous: WorkspaceCoordinates[] = [
      { id: '1', slug: 'one', repositories: ['acme/alpha'] },
      { id: '2', slug: 'two', repositories: ['acme/alpha'] },
    ]
    expect(
      resolveAdoption({ ...project, repoUrl: 'https://github.com/acme/alpha' }, ambiguous, new Map()),
    ).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The endpoints
// ---------------------------------------------------------------------------

interface Store {
  workspaces: Map<string, { id: string; slug: string; name: string; description: string | null; archived: boolean }>
  repositories: Map<string, { workspaceId: string; repositoryId: string; role: string | null }[]>
  environments: Map<string, string[]>
  granted: Set<string>
  /** Set by the test to prove nothing else was touched. */
  destructiveCalls: string[]
}

function workspaceDatabase(granted: string[] = ['acme/alpha', 'acme/api']): { db: Database; store: Store } {
  const store: Store = {
    workspaces: new Map(),
    repositories: new Map(),
    environments: new Map(),
    granted: new Set(granted),
    destructiveCalls: [],
  }
  let nextId = 1

  const db = {
    status: () => ({ configured: true, available: true, reason: null, checkedAt: 0, migrations: [] }),
    projects: { find: async () => null, upsertSeen: async () => ({}), list: async () => [] },
    settings: { listAllProject: async () => [], listAllService: async () => [] },
    github: {
      findRepository: async (fullName: string) =>
        store.granted.has(fullName) ? { id: `repo-${fullName}`, fullName } : null,
      listRepositories: async () => [],
    },
    workspaces: {
      create: async (input: { slug: string; name: string; description: string | null }) => {
        const record = { id: String(nextId++), archived: false, ...input }
        store.workspaces.set(input.slug, record)
        return record
      },
      update: async (slug: string, patch: Record<string, unknown>) => {
        const record = store.workspaces.get(slug)
        if (!record) return null
        const updated = { ...record, ...patch }
        store.workspaces.set(slug, updated)
        return updated
      },
      list: async () => [...store.workspaces.values()],
      find: async (slug: string) => store.workspaces.get(slug) ?? null,
      remove: async (slug: string) => {
        store.destructiveCalls.push(`workspace:${slug}`)
        return store.workspaces.delete(slug)
      },
      listRepositories: async () =>
        [...store.repositories.values()].flat().map((link) => ({
          workspaceId: link.workspaceId,
          repositoryId: link.repositoryId,
          fullName: link.repositoryId.replace('repo-', ''),
          htmlUrl: `https://github.com/${link.repositoryId.replace('repo-', '')}`,
          defaultBranch: 'main',
          private: true,
          archived: false,
          role: link.role,
          position: 0,
        })),
      setRepositories: async (workspaceId: string, links: { repositoryId: string; role: string | null }[]) =>
        void store.repositories.set(
          workspaceId,
          links.map((link) => ({ ...link, workspaceId })),
        ),
      listEnvironments: async () =>
        [...store.environments.entries()].flatMap(([workspaceId, projects]) =>
          projects.map((composeProject) => ({ workspaceId, composeProject, source: 'manual' })),
        ),
      setEnvironments: async (workspaceId: string, projects: string[]) =>
        void store.environments.set(workspaceId, projects),
    },
  }
  return { db: db as unknown as Database, store }
}

function app(granted?: string[]) {
  const { db, store } = workspaceDatabase(granted)
  return { ...makeApp({ containers: [...GATEWAY, ...PROJECT_A, ...PROJECT_B] }, {}, db), store }
}

async function put(instance: ReturnType<typeof app>, path: string, body: unknown) {
  return instance.app.request(path, {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
  })
}

describe('GET/POST /api/workspaces', () => {
  it('creates a workspace that is visible with nothing running', async () => {
    const instance = app()
    const created = await post(instance.app, '/api/workspaces', {
      slug: 'meu-produto',
      name: 'Meu Produto',
      description: 'The thing we sell',
    })
    expect(created.status).toBe(201)

    const list = await (await instance.app.request('/api/workspaces')).json()
    expect(list.workspaces).toEqual([
      expect.objectContaining({
        slug: 'meu-produto',
        name: 'Meu Produto',
        repositoryCount: 0,
        environmentCount: 0,
        runningEnvironmentCount: 0,
      }),
    ])
  })

  it('refuses a duplicate slug rather than silently reusing one', async () => {
    const instance = app()
    await post(instance.app, '/api/workspaces', { slug: 'meu-produto', name: 'One' })
    const second = await post(instance.app, '/api/workspaces', { slug: 'meu-produto', name: 'Two' })
    expect(second.status).toBe(409)
  })

  it('answers 503 with a hint when persistence is unavailable', async () => {
    const { app: bare } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] })
    const response = await bare.request('/api/workspaces')
    expect(response.status).toBe(503)
    expect((await response.json()).hint).toContain('Docker-backed pages remain available')
  })
})

describe('repositories', () => {
  it('accepts one repository, which is the monorepo case', async () => {
    const instance = app()
    await post(instance.app, '/api/workspaces', { slug: 'mono', name: 'Mono' })
    const response = await put(instance, '/api/workspaces/mono/repositories', {
      repositories: [{ fullName: 'acme/alpha', role: 'other' }],
    })
    expect(response.status).toBe(200)
    expect(((await response.json()) as Workspace).repositories).toHaveLength(1)
  })

  it('accepts several, which is the multi-repository product', async () => {
    const instance = app()
    await post(instance.app, '/api/workspaces', { slug: 'produto', name: 'Produto' })
    const response = await put(instance, '/api/workspaces/produto/repositories', {
      repositories: [{ fullName: 'acme/alpha', role: 'web' }, { fullName: 'acme/api', role: 'api' }],
    })
    expect(((await response.json()) as Workspace).repositories.map((entry) => entry.fullName)).toEqual([
      'acme/alpha',
      'acme/api',
    ])
  })

  it('lets one repository belong to two workspaces', async () => {
    const instance = app()
    await post(instance.app, '/api/workspaces', { slug: 'one', name: 'One' })
    await post(instance.app, '/api/workspaces', { slug: 'two', name: 'Two' })
    await put(instance, '/api/workspaces/one/repositories', { repositories: [{ fullName: 'acme/alpha' }] })
    const second = await put(instance, '/api/workspaces/two/repositories', {
      repositories: [{ fullName: 'acme/alpha' }],
    })
    expect(second.status).toBe(200)
  })

  it('refuses a repository outside the installation, and says why', async () => {
    const instance = app()
    await post(instance.app, '/api/workspaces', { slug: 'produto', name: 'Produto' })
    const response = await put(instance, '/api/workspaces/produto/repositories', {
      repositories: [{ fullName: 'someone/else' }],
    })
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toContain('not a repository this gateway was granted')
    expect(body.hint).toContain('docs/github.md')
  })
})

describe('adopting environments', () => {
  it('adopts by hand, and says the mapping was manual', async () => {
    const instance = app()
    await post(instance.app, '/api/workspaces', { slug: 'produto', name: 'Produto' })
    const response = await put(instance, '/api/workspaces/produto/environments', {
      environments: ['alpha'],
    })
    const body = (await response.json()) as Workspace
    expect(body.environments).toEqual([
      expect.objectContaining({ project: 'alpha', source: 'manual', running: true }),
    ])
  })

  it('refuses an environment that is not running', async () => {
    const instance = app()
    await post(instance.app, '/api/workspaces', { slug: 'produto', name: 'Produto' })
    const response = await put(instance, '/api/workspaces/produto/environments', {
      environments: ['ghost'],
    })
    expect(response.status).toBe(400)
  })
})

describe('deleting a workspace', () => {
  it('removes the grouping and nothing else', async () => {
    const instance = app()
    await post(instance.app, '/api/workspaces', { slug: 'produto', name: 'Produto' })
    await put(instance, '/api/workspaces/produto/environments', { environments: ['alpha'] })

    const response = await del(instance.app, '/api/workspaces/produto')
    expect(response.status).toBe(200)
    expect((await response.json()).note).toContain('no container, volume, environment or repository')

    // Nothing was stopped or removed on the Docker side.
    expect(instance.docker.removed).toEqual([])
    expect(instance.docker.calls.filter((call) => ['stop', 'remove'].includes(call.method))).toEqual([])

    // And the environment is still exactly where it was.
    const projects = await (await instance.app.request('/api/projects')).json()
    expect(projects.projects.map((project: { name: string }) => project.name)).toContain('alpha')
  })

  it('404s a workspace that does not exist', async () => {
    const instance = app()
    expect((await del(instance.app, '/api/workspaces/ghost')).status).toBe(404)
  })
})

describe('the existing project endpoints', () => {
  it('behave exactly as before', async () => {
    const instance = app()
    await post(instance.app, '/api/workspaces', { slug: 'produto', name: 'Produto' })
    await put(instance, '/api/workspaces/produto/environments', { environments: ['alpha'] })

    const projects = await (await instance.app.request('/api/projects')).json()
    expect(JSON.stringify(projects)).not.toContain('workspace')
  })
})
