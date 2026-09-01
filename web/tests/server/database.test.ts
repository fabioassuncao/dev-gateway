import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { DatabaseClient } from '../../src/server/db/client.ts'
import { GLOBAL_KEYS, UnknownSettingKey, globalSchema, projectSchema, serviceSchema } from '../../src/server/db/keys.ts'
import { SettingsRepository } from '../../src/server/db/settings.ts'

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
