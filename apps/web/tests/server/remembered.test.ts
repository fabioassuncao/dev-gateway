// A remembered environment: seen before, containers gone, row kept. It is
// listed, it can be started through the runner with the paths the panel
// remembered, and it can be forgotten. A live one is never forgotten.

import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { del, fakeDatabase, makeApp, post, type FakeContainer } from './helpers.ts'
import { PROJECT_A } from './fixtures.ts'
import type { Database } from '../../src/server/db/index.ts'
import type { EnvironmentRecord } from '../../src/server/db/client.ts'
import type { Environment, EnvironmentRunnerStartResult, ProjectLogsResponse } from '../../src/shared/types.ts'
import { loadProjectCatalog } from '../../src/server/core/catalog.ts'
import { createSnapshotCache } from '../../src/server/core/inventory.ts'
import { fakeDocker, testConfig } from './helpers.ts'

const RUNNER: FakeContainer = {
  id: 'gw-runner',
  name: 'portta-runner',
  image: 'fabioassuncao/portta-apply:0.2.0',
  state: 'created',
  startedAt: '0001-01-01T00:00:00Z',
  labels: { 'portta.managed': 'true', 'portta.component': 'runner', 'traefik.enable': 'false' },
}

const GAMMA: EnvironmentRecord = {
  id: 'e-gamma', composeProject: 'gamma', workingDir: '/srv/dev/gamma',
  configFiles: ['/srv/dev/gamma/compose.yaml', '/srv/shared/base.yaml'],
  repoUrl: 'git@github.com:acme/gamma.git', repoSubpath: null,
  firstSeenAt: new Date(0), lastSeenAt: new Date(0), updatedAt: new Date(0),
}

const ALPHA: EnvironmentRecord = { ...GAMMA, id: 'e-alpha', composeProject: 'alpha', workingDir: '/srv/dev/alpha', configFiles: [], repoUrl: null }

/** Unplaced: the panel saw it once but never learnt where Compose ran. */
const LOST: EnvironmentRecord = { ...GAMMA, id: 'e-lost', composeProject: 'lost', workingDir: null, configFiles: [] }

function isolated() {
  const root = mkdtempSync(join(tmpdir(), 'portta-remembered-'))
  return { runnerDir: join(root, 'runner'), accessDir: join(root, 'access'), dynamicDir: join(root, 'dynamic') }
}

function withRecords(records: EnvironmentRecord[], adopted: string[] = []) {
  const db = fakeDatabase()
  const forgotten: string[] = []
  Object.assign(db, {
    environments: {
      find: async (name: string) => records.find((record) => record.composeProject === name) ?? null,
      upsertSeen: async () => records[0],
      list: async () => records,
      recordCounts: async () => ({ overrides: 0, projectLinks: 0, issueLinks: 0 }),
      forget: async (name: string) => { forgotten.push(name); return { overrides: 0, projectLinks: 0, issueLinks: 0 } },
    },
    projects: {
      find: async () => null,
      list: async () => [{ id: 'p1', slug: 'acme', name: 'Acme', description: null, archived: false, relativePath: null, createdAt: new Date(0), updatedAt: new Date(0) }],
      listEnvironments: async () => adopted.map((composeProject) => ({ projectId: 'p1', composeProject, source: 'manual' })),
    },
  })
  return { db: db as unknown as Database, forgotten }
}

describe('GET /api/environments with remembered rows', () => {
  it('appends the remembered ones after the live ones with ?all=true', async () => {
    const { db } = withRecords([ALPHA, GAMMA])
    const { app } = makeApp({ containers: PROJECT_A }, {}, db)
    const { environments } = (await (await app.request('/api/environments?all=true')).json()) as { environments: Environment[] }
    expect(environments.map((environment) => [environment.name, environment.presence])).toEqual([['alpha', 'live'], ['gamma', 'remembered']])
    const gamma = environments[1]!
    expect(gamma.services).toEqual([])
    expect(gamma.serviceCount).toBe(0)
    expect(gamma.integrated).toBe(false)
    expect(gamma.workingDir).toBe('/srv/dev/gamma')
    expect(gamma.operable).toEqual({ ok: true, reason: null, workingDir: '/srv/dev/gamma', configFiles: GAMMA.configFiles })
    expect(gamma.repoUrl).toBe('git@github.com:acme/gamma.git')
  })

  it('without the runner, startable carries the exact compose command', async () => {
    const { db } = withRecords([GAMMA])
    const { app } = makeApp({ containers: PROJECT_A }, {}, db)
    const { environments } = (await (await app.request('/api/environments?all=true')).json()) as { environments: Environment[] }
    expect(environments.find((environment) => environment.name === 'gamma')?.startable).toEqual({
      ok: false,
      reason: "docker compose --project-name gamma --project-directory '/srv/dev/gamma' -f '/srv/dev/gamma/compose.yaml' -f '/srv/shared/base.yaml' up -d",
      via: 'runner',
    })
  })

  it('with the runner, a remembered environment is startable through it', async () => {
    const { db } = withRecords([GAMMA])
    const { app } = makeApp({ containers: [...PROJECT_A, RUNNER] }, {}, db)
    const { environments } = (await (await app.request('/api/environments?all=true')).json()) as { environments: Environment[] }
    expect(environments.find((environment) => environment.name === 'gamma')?.startable).toEqual({ ok: true, reason: null, via: 'runner' })
  })

  it('one with no working directory is not operable and says so', async () => {
    const { db } = withRecords([LOST])
    const { app } = makeApp({ containers: [...PROJECT_A, RUNNER] }, {}, db)
    const { environments } = (await (await app.request('/api/environments?all=true')).json()) as { environments: Environment[] }
    const lost = environments.find((environment) => environment.name === 'lost')!
    expect(lost.operable.ok).toBe(false)
    expect(lost.startable.ok).toBe(false)
    expect(lost.startable.reason).toContain('containers are gone')
  })

  it('the default list keeps only the remembered ones a Project adopted', async () => {
    const { db } = withRecords([GAMMA, LOST], ['gamma'])
    const { app } = makeApp({ containers: PROJECT_A }, {}, db)
    const { environments } = (await (await app.request('/api/environments')).json()) as { environments: Environment[] }
    expect(environments.map((environment) => environment.name)).toEqual(['alpha', 'gamma'])
  })

  it('is byte-identical to today with no database', async () => {
    const { app } = makeApp({ containers: PROJECT_A })
    const { environments } = (await (await app.request('/api/environments?all=true')).json()) as { environments: Environment[] }
    expect(environments.map((environment) => environment.name)).toEqual(['alpha'])
    expect(environments[0]!.presence).toBe('live')
  })
})

describe('GET /api/environments/:project for a remembered one', () => {
  it('answers with presence remembered and no services', async () => {
    const { db } = withRecords([GAMMA])
    const { app } = makeApp({ containers: PROJECT_A }, {}, db)
    const response = await app.request('/api/environments/gamma')
    expect(response.status).toBe(200)
    const body = (await response.json()) as Environment
    expect(body.presence).toBe('remembered')
    expect(body.services).toEqual([])
  })

  it('services and logs are the empty shapes, git the collected one', async () => {
    const { db } = withRecords([GAMMA])
    const { app } = makeApp({ containers: PROJECT_A }, {}, db)
    const services = await app.request('/api/environments/gamma/services')
    expect(services.status).toBe(200)
    expect(((await services.json()) as { services: unknown[] }).services).toEqual([])
    const logs = await app.request('/api/environments/gamma/logs')
    expect(logs.status).toBe(200)
    const body = (await logs.json()) as ProjectLogsResponse
    expect(body.sources).toEqual([])
    expect(body.lines).toEqual([])
    expect((await app.request('/api/environments/gamma/git')).status).toBe(200)
  })

  it('still 404s for a name nobody remembers', async () => {
    const { db } = withRecords([GAMMA])
    const { app } = makeApp({ containers: PROJECT_A }, {}, db)
    expect((await app.request('/api/environments/nope')).status).toBe(404)
    expect((await app.request('/api/environments/nope/services')).status).toBe(404)
  })
})

describe('POST /api/environments/:project/actions/start for a remembered one', () => {
  it('without the runner: 409, and the hint is the command to run on the host', async () => {
    const { db } = withRecords([GAMMA])
    const { app } = makeApp({ containers: PROJECT_A }, isolated(), db)
    const response = await post(app, '/api/environments/gamma/actions/start')
    expect(response.status).toBe(409)
    const body = (await response.json()) as { error: string; hint: string }
    expect(body.error).toContain('runner is not available')
    expect(body.hint).toBe("docker compose --project-name gamma --project-directory '/srv/dev/gamma' -f '/srv/dev/gamma/compose.yaml' -f '/srv/shared/base.yaml' up -d")
  })

  it('with the runner: writes an up request carrying the paths and starts it', async () => {
    const { db } = withRecords([GAMMA])
    const config = isolated()
    const { app, docker } = makeApp({ containers: [...PROJECT_A, RUNNER] }, config, db)
    const response = await post(app, '/api/environments/gamma/actions/start')
    expect(response.status).toBe(200)
    const body = (await response.json()) as EnvironmentRunnerStartResult
    expect(body).toMatchObject({ ok: true, project: 'gamma', action: 'start', via: 'runner' })
    expect(body.runner.available).toBe(true)
    expect(JSON.parse(readFileSync(join(config.runnerDir, 'request.json'), 'utf8'))).toEqual({
      verb: 'up', project: 'gamma', flags: [],
      workingDir: '/srv/dev/gamma', configFiles: ['/srv/dev/gamma/compose.yaml', '/srv/shared/base.yaml'],
    })
    expect(docker.calls.some((call) => call.method === 'start' && call.args[0] === 'gw-runner')).toBe(true)
    const activity = (db as unknown as { activity: { rows: { kind: string; summary: string }[] } }).activity.rows
    expect(activity[0]).toMatchObject({ kind: 'environment.started', summary: expect.stringContaining('gamma') })
  })

  it('a live environment still iterates its containers, whatever the database says', async () => {
    const { db } = withRecords([ALPHA])
    const config = isolated()
    const { app } = makeApp({ containers: [...PROJECT_A.map((entry) => ({ ...entry, state: 'exited' })), RUNNER] }, config, db)
    const response = await post(app, '/api/environments/alpha/actions/start')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ action: 'start', requested: 4 })
  })

  it('refuses one with no working directory', async () => {
    const { db } = withRecords([LOST])
    const { app } = makeApp({ containers: [...PROJECT_A, RUNNER] }, isolated(), db)
    expect((await post(app, '/api/environments/lost/actions/start')).status).toBe(409)
  })

  it("refuses Portta's own project by name", async () => {
    const { db } = withRecords([{ ...GAMMA, composeProject: 'portta', workingDir: '/opt/portta' }])
    const { app } = makeApp({ containers: [...PROJECT_A, RUNNER] }, isolated(), db)
    const response = await post(app, '/api/environments/portta/actions/start')
    expect(response.status).toBe(403)
    expect(((await response.json()) as { error: string }).error).toContain("Portta's own project")
  })
})

describe('DELETE /api/environments/:project', () => {
  it('forgets a remembered environment', async () => {
    const { db, forgotten } = withRecords([GAMMA])
    const { app } = makeApp({ containers: PROJECT_A }, {}, db)
    const response = await del(app, '/api/environments/gamma')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, forgotten: 'gamma' })
    expect(forgotten).toEqual(['gamma'])
    const activity = (db as unknown as { activity: { rows: { kind: string }[] } }).activity.rows
    expect(activity[0]).toMatchObject({ kind: 'environment.forgotten' })
  })

  it('refuses a live one: stop and remove it first', async () => {
    const { db, forgotten } = withRecords([ALPHA])
    const { app } = makeApp({ containers: PROJECT_A }, {}, db)
    const response = await del(app, '/api/environments/alpha')
    expect(response.status).toBe(409)
    expect(((await response.json()) as { hint: string }).hint).toContain('stop and remove it first')
    expect(forgotten).toEqual([])
  })

  it('404s for a name nobody remembers, 503 with no persistence', async () => {
    const { db } = withRecords([GAMMA])
    expect((await del(makeApp({ containers: PROJECT_A }, {}, db).app, '/api/environments/nope')).status).toBe(404)
    expect((await del(makeApp({ containers: PROJECT_A }).app, '/api/environments/gamma')).status).toBe(503)
  })
})

describe('the Project catalogue', () => {
  it('keeps a remembered environment the Project adopted by hand, not running', async () => {
    const { db } = withRecords([GAMMA], ['gamma'])
    const docker = fakeDocker({ containers: PROJECT_A })
    const config = testConfig()
    const snapshot = await createSnapshotCache(docker.client, config, 0).get()
    const catalog = await loadProjectCatalog(db, snapshot, config)
    expect(catalog.environments.get('p1')).toEqual([
      { environment: 'gamma', source: 'manual', attribution: 'resolved', running: false, serviceCount: 0, runningCount: 0, unhealthyCount: 0, urls: [] },
    ])
  })
})
