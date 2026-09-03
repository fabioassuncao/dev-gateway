import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { del, makeApp, post } from './helpers.ts'
import { GATEWAY, PROJECT_A, PROJECT_B } from './fixtures.ts'
import {
  repositoryCoordinate,
  resolveAdoption,
  type ProjectCoordinates,
} from '../../src/server/core/adoption.ts'
import type { Database } from '../../src/server/db/index.ts'
import type { Project } from '../../src/shared/types.ts'

describe('the development-model schema', () => {
  const migration = readFileSync(new URL('../../migrations/0007_environments_and_projects.sql', import.meta.url), 'utf8')

  it('renames the observation before the decision, so the names cannot collide', () => {
    expect(migration.indexOf('ALTER TABLE projects RENAME TO environments')).toBeLessThan(
      migration.indexOf('ALTER TABLE workspaces RENAME TO projects'),
    )
  })

  it('renames the index-backed constraints and sequences explicitly', () => {
    for (const name of [
      'projects_id_seq RENAME TO environments_id_seq',
      'projects_pkey TO environments_pkey',
      'workspaces_id_seq RENAME TO projects_id_seq',
      'workspaces_pkey TO projects_pkey',
      'workspaces_slug_key TO projects_slug_key',
      'workspaces_relative_path_unique RENAME TO projects_relative_path_unique',
    ]) {
      expect(migration).toContain(name)
    }
  })

  it('drops what nothing ever wrote', () => {
    expect(migration).toContain('DROP TABLE integrations')
    expect(migration).toContain('DROP COLUMN slug')
    expect(migration).toContain('DROP COLUMN display_name')
    expect(migration).toContain('DROP COLUMN archived')
  })

  it('gives an environment at most one Project, and records why', () => {
    expect(migration).toContain('project_environments_one_project_per_env')
    expect(migration).toContain("source IN ('manual', 'label', 'repo-match', 'path')")
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

const PROJECTS: ProjectCoordinates[] = [
  { id: '1', slug: 'meu-produto', repositories: ['acme/alpha', 'acme/api'] },
  { id: '2', slug: 'outro', repositories: ['acme/beta'] },
]

describe('adoption precedence', () => {
  const project = { name: 'alpha', group: null, repo: null, repoUrl: null }

  it('adopts nothing when there is nothing to go on', () => {
    expect(resolveAdoption(project, PROJECTS, new Map())).toBeNull()
  })

  it('honours the portta.project label the project declared', () => {
    expect(resolveAdoption({ ...project, group: 'meu-produto' }, PROJECTS, new Map())).toEqual({
      projectId: '1',
      source: 'label',
    })
  })

  it('lets a manual mapping override the label', () => {
    expect(
      resolveAdoption({ ...project, group: 'meu-produto' }, PROJECTS, new Map([['alpha', '2']])),
    ).toEqual({ projectId: '2', source: 'manual' })
  })

  it('matches on the repository when exactly one Project owns it', () => {
    expect(
      resolveAdoption(
        { ...project, repoUrl: 'git@github.com:acme/alpha.git' },
        PROJECTS,
        new Map(),
      ),
    ).toEqual({ projectId: '1', source: 'repo-match' })
  })

  it('adopts nothing when two Projects own the same repository', () => {
    const ambiguous: ProjectCoordinates[] = [
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
  projects: Map<string, { id: string; slug: string; name: string; description: string | null; archived: boolean; relativePath: string | null }>
  repositories: Map<string, { projectId: string; repositoryId: string; role: string | null }[]>
  environments: Map<string, string[]>
  granted: Set<string>
  /** Set by the test to prove nothing else was touched. */
  destructiveCalls: string[]
}

function projectDatabase(granted: string[] = ['acme/alpha', 'acme/api']): { db: Database; store: Store } {
  const store: Store = {
    projects: new Map(),
    repositories: new Map(),
    environments: new Map(),
    granted: new Set(granted),
    destructiveCalls: [],
  }
  let nextId = 1

  const db = {
    status: () => ({ configured: true, available: true, reason: null, checkedAt: 0, migrations: [] }),
    environments: { find: async () => null, upsertSeen: async () => ({}), list: async () => [] },
    settings: { listAllEnvironment: async () => [], listAllService: async () => [] },
    github: {
      findRepository: async (fullName: string) =>
        store.granted.has(fullName) ? { id: `repo-${fullName}`, fullName } : null,
      listRepositories: async () => [],
      listIssues: async () => [],
      listIssueEnvironments: async () => [],
      listRelationships: async () => [],
    },
    projects: {
      create: async (input: { slug: string; name: string; description: string | null; relativePath: string | null }) => {
        const record = { id: String(nextId++), archived: false, ...input }
        store.projects.set(input.slug, record)
        return record
      },
      update: async (slug: string, patch: Record<string, unknown>) => {
        const record = store.projects.get(slug)
        if (!record) return null
        const updated = { ...record, ...patch }
        store.projects.set(slug, updated)
        return updated
      },
      list: async () => [...store.projects.values()],
      find: async (slug: string) => store.projects.get(slug) ?? null,
      remove: async (slug: string) => {
        store.destructiveCalls.push(`project:${slug}`)
        return store.projects.delete(slug)
      },
      listRepositories: async () =>
        [...store.repositories.values()].flat().map((link) => ({
          projectId: link.projectId,
          repositoryId: link.repositoryId,
          fullName: link.repositoryId.replace('repo-', ''),
          htmlUrl: `https://github.com/${link.repositoryId.replace('repo-', '')}`,
          defaultBranch: 'main',
          private: true,
          archived: false,
          role: link.role,
          position: 0,
        })),
      setRepositories: async (projectId: string, links: { repositoryId: string; role: string | null }[]) =>
        void store.repositories.set(
          projectId,
          links.map((link) => ({ ...link, projectId })),
        ),
      listEnvironments: async () =>
        [...store.environments.entries()].flatMap(([projectId, environments]) =>
          environments.map((composeProject) => ({ projectId, composeProject, source: 'manual' })),
        ),
      setEnvironments: async (projectId: string, environments: string[]) =>
        void store.environments.set(projectId, environments),
    },
  }
  return { db: db as unknown as Database, store }
}

function app(granted?: string[]) {
  const { db, store } = projectDatabase(granted)
  return { ...makeApp({ containers: [...GATEWAY, ...PROJECT_A, ...PROJECT_B] }, {}, db), store }
}

async function put(instance: ReturnType<typeof app>, path: string, body: unknown) {
  return instance.app.request(path, {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
  })
}

describe('GET/POST /api/projects', () => {
  it('creates a Project that is visible with nothing running', async () => {
    const instance = app()
    const created = await post(instance.app, '/api/projects', {
      slug: 'meu-produto',
      name: 'Meu Produto',
      description: 'The thing we sell',
    })
    expect(created.status).toBe(201)

    const list = await (await instance.app.request('/api/projects')).json()
    expect(list.projects).toEqual([
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
    await post(instance.app, '/api/projects', { slug: 'meu-produto', name: 'One' })
    const second = await post(instance.app, '/api/projects', { slug: 'meu-produto', name: 'Two' })
    expect(second.status).toBe(409)
  })

  it('answers 503 with a hint when persistence is unavailable', async () => {
    const { app: bare } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] })
    const response = await bare.request('/api/projects')
    expect(response.status).toBe(503)
    expect((await response.json()).hint).toContain('Docker-backed pages remain available')
  })
})

describe('placing a Project under Projects Home', () => {
  it('stores a first-level directory name and reports it as managed', async () => {
    const instance = app()
    const created = await post(instance.app, '/api/projects', { slug: 'produto', name: 'Produto', relativePath: 'produto' })
    expect(created.status).toBe(201)
    expect(((await created.json()) as Project).location).toBe('managed')
  })

  it('refuses an absolute path, a parent reference or a nested path', async () => {
    const instance = app()
    for (const relativePath of ['/srv/projects/produto', '../produto', 'a/b']) {
      const response = await post(instance.app, '/api/projects', { slug: `p-${relativePath.length}`, name: 'P', relativePath })
      expect(response.status, relativePath).toBe(400)
    }
  })
})

describe('the deprecated aliases', () => {
  it('are gone: /api/workspaces is a 404, not a second name', async () => {
    const instance = app()
    expect((await instance.app.request('/api/workspaces')).status).toBe(404)
    expect((await post(instance.app, '/api/workspaces', { slug: 'x', name: 'X' })).status).toBe(404)
  })
})

describe('repositories', () => {
  it('accepts one repository, which is the monorepo case', async () => {
    const instance = app()
    await post(instance.app, '/api/projects', { slug: 'mono', name: 'Mono' })
    const response = await put(instance, '/api/projects/mono/repositories', {
      repositories: [{ fullName: 'acme/alpha', role: 'other' }],
    })
    expect(response.status).toBe(200)
    expect(((await response.json()) as Project).githubRepositories).toHaveLength(1)
  })

  it('accepts several, which is the multi-repository product', async () => {
    const instance = app()
    await post(instance.app, '/api/projects', { slug: 'produto', name: 'Produto' })
    const response = await put(instance, '/api/projects/produto/repositories', {
      repositories: [{ fullName: 'acme/alpha', role: 'web' }, { fullName: 'acme/api', role: 'api' }],
    })
    expect(((await response.json()) as Project).githubRepositories.map((entry) => entry.fullName)).toEqual([
      'acme/alpha',
      'acme/api',
    ])
  })

  it('lets one repository belong to two Projects, until the tightening lands', async () => {
    const instance = app()
    await post(instance.app, '/api/projects', { slug: 'one', name: 'One' })
    await post(instance.app, '/api/projects', { slug: 'two', name: 'Two' })
    await put(instance, '/api/projects/one/repositories', { repositories: [{ fullName: 'acme/alpha' }] })
    const second = await put(instance, '/api/projects/two/repositories', {
      repositories: [{ fullName: 'acme/alpha' }],
    })
    expect(second.status).toBe(200)
  })

  it('refuses a repository outside the installation, and says why', async () => {
    const instance = app()
    await post(instance.app, '/api/projects', { slug: 'produto', name: 'Produto' })
    const response = await put(instance, '/api/projects/produto/repositories', {
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
    await post(instance.app, '/api/projects', { slug: 'produto', name: 'Produto' })
    const response = await put(instance, '/api/projects/produto/environments', {
      environments: ['alpha'],
    })
    const body = (await response.json()) as Project
    expect(body.environments).toEqual([
      expect.objectContaining({ environment: 'alpha', source: 'manual', running: true }),
    ])
  })

  it('refuses an environment that is not running', async () => {
    const instance = app()
    await post(instance.app, '/api/projects', { slug: 'produto', name: 'Produto' })
    const response = await put(instance, '/api/projects/produto/environments', {
      environments: ['ghost'],
    })
    expect(response.status).toBe(400)
  })
})

describe('deleting a Project', () => {
  it('removes the grouping and nothing else', async () => {
    const instance = app()
    await post(instance.app, '/api/projects', { slug: 'produto', name: 'Produto' })
    await put(instance, '/api/projects/produto/environments', { environments: ['alpha'] })

    const response = await del(instance.app, '/api/projects/produto')
    expect(response.status).toBe(200)
    expect((await response.json()).note).toContain('no container, volume, environment or repository')

    // Nothing was stopped or removed on the Docker side.
    expect(instance.docker.removed).toEqual([])
    expect(instance.docker.calls.filter((call) => ['stop', 'remove'].includes(call.method))).toEqual([])

    // And the environment is still exactly where it was.
    const runtimes = await (await instance.app.request('/api/environments')).json()
    expect(runtimes.environments.map((environment: { name: string }) => environment.name)).toContain('alpha')
  })

  it('404s a Project that does not exist', async () => {
    const instance = app()
    expect((await del(instance.app, '/api/projects/ghost')).status).toBe(404)
  })
})

describe('the environment endpoints', () => {
  it('never say workspace', async () => {
    const instance = app()
    await post(instance.app, '/api/projects', { slug: 'produto', name: 'Produto' })
    await put(instance, '/api/projects/produto/environments', { environments: ['alpha'] })

    const runtimes = await (await instance.app.request('/api/environments')).json()
    expect(JSON.stringify(runtimes)).not.toContain('workspace')
  })
})
