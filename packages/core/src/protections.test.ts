import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  emptyProtectionStore,
  InvalidProtectionStore,
  normalizeProtectionHost,
  panelProtectionRecord,
  parseProtectionStore,
  protectionForHost,
  readProtectionStore,
  removeProtection,
  setProtection,
  writeProtectionStore,
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
})
