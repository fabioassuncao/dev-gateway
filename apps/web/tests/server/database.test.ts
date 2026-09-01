import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { DatabaseClient } from '../../src/server/db/client.ts'
import { GLOBAL_KEYS, UnknownSettingKey, globalSchema, projectSchema, serviceSchema } from '../../src/server/db/keys.ts'
import { SettingsRepository } from '../../src/server/db/settings.ts'
import { Database, requireDatabase, unavailableDatabaseStatus } from '../../src/server/db/index.ts'
import { diagnose } from '../../src/server/core/diagnostics.ts'
import { buildSnapshot } from '../../src/server/core/inventory.ts'
import { fakeDocker, makeApp, testConfig } from './helpers.ts'
import { FULL_HOST } from './fixtures.ts'

describe('the persistence schema', () => {
  const migration = readFileSync(new URL('../../migrations/0001_initial.sql', import.meta.url), 'utf8')

  it('has the local identity and portable project coordinates decided before implementation', () => {
    expect(migration).toContain('compose_project TEXT NOT NULL UNIQUE')
    expect(migration).toContain('repo_url')
    expect(migration).toContain('repo_subpath')
    expect(migration).toContain('slug')
    expect(migration).toContain('id          UUID PRIMARY KEY')
  })

  it('timestamps every project- and user-scoped decision', () => {
    expect(migration.match(/updated_at/g)?.length).toBeGreaterThanOrEqual(5)
  })

  it('contains no runtime observation tables', () => {
    expect(migration).not.toMatch(/CREATE TABLE (containers|urls|health|ports|networks|logs)\b/)
  })

  it('cascades settings when their local project identity is removed', () => {
    expect(migration.match(/REFERENCES projects\(id\) ON DELETE CASCADE/g)).toHaveLength(3)
  })
})

describe('the closed setting catalogue', () => {
  it('accepts only declared, validated values', () => {
    expect(globalSchema('theme').parse('dark')).toBe('dark')
    expect(projectSchema('hiddenServices').parse(['mailpit'])).toEqual(['mailpit'])
    expect(serviceSchema('alias').parse('storefront-api')).toBe('storefront-api')
    expect(() => serviceSchema('alias').parse('Not A Host')).toThrow()
  })

  it('refuses an unknown key before any database call', () => {
    expect(() => globalSchema('arbitrarySql')).toThrow(UnknownSettingKey)
    expect(Object.keys(GLOBAL_KEYS)).not.toContain('arbitrarySql')
  })

  it('falls back to null when a hand-edited row is invalid', async () => {
    const client = {
      getGlobalSetting: vi.fn().mockResolvedValue('neon-pink'),
    } as unknown as DatabaseClient
    const settings = new SettingsRepository(client)

    await expect(settings.getGlobal('theme')).resolves.toBeNull()
  })

  it('validates before writing', async () => {
    const setGlobalSetting = vi.fn().mockResolvedValue(undefined)
    const client = { setGlobalSetting } as unknown as DatabaseClient
    const settings = new SettingsRepository(client)

    await settings.setGlobal('theme', 'dark')
    expect(setGlobalSetting).toHaveBeenCalledWith('theme', 'dark')
  })
})

describe('degraded operation', () => {
  function databaseWith(client: Partial<DatabaseClient>): Database {
    const Constructor = Database as unknown as new (databaseClient: DatabaseClient) => Database
    return new Constructor(client as DatabaseClient)
  }

  it('keeps every existing read surface available with db null', async () => {
    const { app } = makeApp({ containers: FULL_HOST })
    const paths = [
      '/api/health',
      '/api/status',
      '/api/projects',
      '/api/services',
      '/api/docker/containers',
      '/api/docker/host',
      '/api/network',
      '/api/access',
      '/api/gateway',
      '/api/config',
      '/api/openapi.json',
    ]

    for (const path of paths) {
      expect((await app.request(path)).status, path).toBe(200)
    }
  })

  it('reports an unavailable configured database as a warning', async () => {
    const config = testConfig()
    const docker = fakeDocker({ containers: FULL_HOST })
    const snapshot = await buildSnapshot(docker.client, config)
    const status = unavailableDatabaseStatus(true, 'connection refused')
    const database = diagnose(snapshot, config, null, [], status).find((check) => check.id === 'database')

    expect(database).toMatchObject({ status: 'warn', fix: 'dev-gateway db status' })
  })

  it('turns a future persistence write into a clear 503 boundary', () => {
    expect(() => requireDatabase(null)).toThrow(/persistence is unavailable/)
  })

  it('retries migrations and records projects after a startup outage', async () => {
    let unavailable = true
    const client = {
      migrate: vi.fn(async () => {
        if (unavailable) throw new Error('connection refused')
        return [{ version: '0001_initial.sql', appliedAt: new Date() }]
      }),
      ping: vi.fn().mockResolvedValue(undefined),
      upsertSeen: vi.fn().mockResolvedValue({ id: '1' }),
    }
    const database = databaseWith(client)

    await expect(database.initialize()).rejects.toThrow('connection refused')
    expect(database.status().available).toBe(false)

    unavailable = false
    await database.recordSeen([{ name: 'demo-a', workingDir: null, repoUrl: null, gitRoot: null }])

    expect(database.status()).toMatchObject({ available: true, migrations: ['0001_initial.sql'] })
    expect(client.upsertSeen).toHaveBeenCalledOnce()
  })

  it('coalesces concurrent migration retries', async () => {
    const client = {
      migrate: vi.fn().mockResolvedValue([{ version: '0001_initial.sql', appliedAt: new Date() }]),
      ping: vi.fn().mockResolvedValue(undefined),
    }
    const database = databaseWith(client)

    await Promise.all([database.initialize(), database.initialize(), database.initialize()])

    expect(client.migrate).toHaveBeenCalledOnce()
    expect(client.ping).toHaveBeenCalledOnce()
  })
})
