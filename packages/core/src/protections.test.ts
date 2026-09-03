import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  emptyProtectionStore,
  InvalidProtectionStore,
  normalizeProtectionHost,
  dashboardProtectionRecord,
  panelProtectionRecord,
  parseProtectionStore,
  protectionForHost,
  readProtectionStore,
  removeProtection,
  setProtection,
  writeProtectionStore,
  createApiToken,
  apiTokenFor,
  revokeApiToken,
} from './protections.ts'

const record = {
  scope: 'project:demo.example.com',
  host: 'Demo.Example.com.',
  entryPoints: ['websecure'],
  user: 'reviewer',
  hash: '$apr1$abcdefgh$ckT15POyCRlen.h6XtGAZ1',
  label: 'Demo',
}

describe('protection store', () => {
  it('normalizes authorities without widening them', () => {
    expect(normalizeProtectionHost('Example.COM.')).toBe('example.com')
    expect(normalizeProtectionHost('127.0.0.1:8090')).toBe('127.0.0.1:8090')
    expect(() => normalizeProtectionHost('https://evil.example')).toThrow(InvalidProtectionStore)
    expect(() => normalizeProtectionHost('good.example/path')).toThrow(InvalidProtectionStore)
  })

  it('sets one scope, increments its epoch and prevents host ambiguity', () => {
    const first = setProtection(emptyProtectionStore(), record)
    const second = setProtection(first, { ...record, hash: '{SHA}W6ph5Mm5Pz8GgiULbPgzG37mj9g=' })
    expect(second.protections).toHaveLength(1)
    expect(second.protections[0]?.epoch).toBe(2)
    expect(protectionForHost(second, 'DEMO.EXAMPLE.COM')).toEqual(second.protections[0])
    expect(() => setProtection(second, { ...record, scope: 'another' })).toThrow('already protected')
    expect(removeProtection(second, record.scope).protections).toEqual([])
  })

  it('writes atomically and privately', () => {
    const directory = mkdtempSync(join(tmpdir(), 'portta-protections-'))
    const path = join(directory, 'state/auth/protections.json')
    const store = setProtection(emptyProtectionStore(), record)
    writeProtectionStore(path, store)
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(readProtectionStore(path)).toEqual(store)
    expect(readFileSync(path, 'utf8').endsWith('\n')).toBe(true)
  })

  it('stores only a digest for revocable API tokens', () => {
    const created = createApiToken(emptyProtectionStore(), { name: 'Codex', actor: 'codex', capabilities: ['task:read', 'task:write'] }, new Date('2026-01-01T00:00:00Z'))
    expect(created.token).toMatch(/^ptt_/)
    expect(JSON.stringify(created.store)).not.toContain(created.token)
    expect(apiTokenFor(created.store, created.token)).toMatchObject({ actor: 'codex', capabilities: ['task:read', 'task:write'], revokedAt: null })
    const revoked = revokeApiToken(created.store, created.record.id, new Date('2026-01-02T00:00:00Z'))
    expect(apiTokenFor(revoked, created.token)).toBeNull()
  })

  it('refuses duplicate, malformed and future state', () => {
    expect(() => parseProtectionStore('{')).toThrow('not valid JSON')
    expect(() => parseProtectionStore('{"version":2,"protections":[]}')).toThrow('unsupported')
    expect(() => parseProtectionStore(JSON.stringify({ version: 1, protections: [{ ...record, epoch: 1 }, { ...record, scope: 'other', epoch: 1 }] }))).toThrow('duplicate protection host')
  })

  it('derives the exact panel authority and entrypoint', () => {
    const base = { mode: 'basic', user: 'dev', hash: '$apr1$a$b', webHost: 'portta-web', domain: 'dev.example.com', port: '8081', tlsEnabled: true, projectName: 'portta' }
    expect(panelProtectionRecord({ ...base, expose: 'vpn' })).toMatchObject({ host: 'portta-web.dev.example.com', entryPoints: ['websecure'] })
    expect(panelProtectionRecord({ ...base, expose: 'public', advertisedHost: '203.0.113.4' })).toMatchObject({ host: '203.0.113.4:8081', entryPoints: ['panel'] })
    expect(panelProtectionRecord({ ...base, expose: 'local' })).toBeNull()
    expect(() => panelProtectionRecord({ ...base, expose: 'public' })).toThrow('advertised host')
  })

  // The Compose router matches Host(PORTTA_PANEL_ADVERTISED_HOST) and the
  // credential is looked up by the forwarded host. They are the same value
  // here, verbatim: a mismatch fails the panel closed, which is the right
  // direction to fail but a confusing one to debug.
  it('routes the panel on the advertised host itself, with no port', () => {
    const base = { mode: 'basic', user: 'dev', hash: '$apr1$a$b', webHost: 'portta-web', domain: 'dev.example.com', port: '8081', tlsEnabled: true, projectName: 'portta' }
    expect(panelProtectionRecord({ ...base, expose: 'domain', advertisedHost: 'dev.example.com' }))
      .toMatchObject({ host: 'dev.example.com', entryPoints: ['websecure'] })
    // A subdomain of the gateway domain is the same case, not a special one.
    expect(panelProtectionRecord({ ...base, expose: 'domain', advertisedHost: 'panel.dev.example.com' }))
      .toMatchObject({ host: 'panel.dev.example.com', entryPoints: ['websecure'] })
    // Without TLS the entrypoint is :80, and the credential would cross in
    // clear text -- the CLI refuses that, but the record still has to be honest.
    expect(panelProtectionRecord({ ...base, expose: 'domain', advertisedHost: 'dev.example.com', tlsEnabled: false }))
      .toMatchObject({ entryPoints: ['web'] })
    expect(() => panelProtectionRecord({ ...base, expose: 'domain' })).toThrow('advertised host')
  })

  it('covers the dashboard host with the same credential, as its own scope', () => {
    expect(dashboardProtectionRecord({
      expose: 'domain',
      advertisedHost: 'portta-traefik.dev.example.com',
      mode: 'basic',
      user: 'dev',
      hash: '$apr1$a$b',
      tlsEnabled: true,
      projectName: 'portta',
    })).toMatchObject({
      scope: 'dashboard',
      host: 'portta-traefik.dev.example.com',
      entryPoints: ['websecure'],
    })
    expect(dashboardProtectionRecord({
      expose: 'local', advertisedHost: 'portta-traefik.dev.example.com',
      mode: 'basic', user: 'dev', hash: 'x', tlsEnabled: true, projectName: 'portta',
    })).toBeNull()
  })
})
