import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BACKUP_VERSION, REPAIR_DIRECTORIES, REPAIR_MODES, backupPaths, humanSize, parseManifest, renderManifest } from './maintenance.ts'

function fakeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'portta-maint-'))
  writeFileSync(join(root, '.env'), 'PORTTA_PROFILE=local\n')
  writeFileSync(join(root, 'VERSION'), '0.4.0\n')
  mkdirSync(join(root, 'config/traefik/dynamic'), { recursive: true })
  mkdirSync(join(root, 'state/git'), { recursive: true })
  // Everything the installer can fetch again:
  mkdirSync(join(root, 'bin'))
  mkdirSync(join(root, 'scripts'))
  mkdirSync(join(root, 'docker'))
  return root
}

describe('backupPaths', () => {
  // Including the code would make the archive a stale copy of the release, and
  // restoring it onto a newer Portta would quietly downgrade it while claiming
  // to restore data.
  it('takes what cannot be regenerated and leaves what the installer can fetch', () => {
    const root = fakeRoot()
    try {
      expect(backupPaths(root)).toEqual(['.env', 'VERSION', 'config', 'state'])
      for (const path of backupPaths(root)) expect(['bin', 'scripts', 'docker']).not.toContain(path)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('names only what is there, so a partial installation still backs up', () => {
    const root = mkdtempSync(join(tmpdir(), 'portta-maint-'))
    try {
      writeFileSync(join(root, '.env'), '')
      expect(backupPaths(root)).toEqual(['.env'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('the manifest', () => {
  // The format is a contract across versions: an archive written by an older
  // Portta must restore under a newer one.
  it('round-trips, and pins the archive version at 1', () => {
    const manifest = { version: BACKUP_VERSION, portta: '0.4.0', created: '2026-09-02T00:00:00Z', host: 'vps' }
    expect(BACKUP_VERSION).toBe(1)
    expect(parseManifest(renderManifest(manifest))).toEqual(manifest)
  })

  it('reads one written by the shell implementation', () => {
    const legacy = '{"version":1,"portta":"0.3.0","created":"2026-01-01T00:00:00Z","host":"old-host"}\n'
    expect(parseManifest(legacy)).toEqual({ version: 1, portta: '0.3.0', created: '2026-01-01T00:00:00Z', host: 'old-host' })
  })

  it('refuses a document that is not one, rather than restoring from nothing', () => {
    expect(parseManifest('not json')).toBeNull()
    expect(parseManifest('{}')).toBeNull()
    expect(parseManifest('{"portta":"0.4.0"}')).toBeNull()
  })

  it('survives a manifest missing the fields that are only for the reader', () => {
    expect(parseManifest('{"version":1}')).toEqual({ version: 1, portta: 'unknown', created: '', host: '' })
  })
})

describe('the repair plan', () => {
  // A missing bind-mount directory makes Docker create it as root, which then
  // breaks the panel writing to it. Creating it with the mode it must end up
  // with is what stops the permission pass reporting work this list just made.
  it('creates the private directories private, not world-readable then fixed', () => {
    const byPath = new Map(REPAIR_DIRECTORIES.map((entry) => [entry.path, entry.mode]))
    expect(byPath.get('state/traefik/acme')).toBe(0o700)
    expect(byPath.get('state/cloudflared')).toBe(0o700)
    expect(byPath.get('state/git')).toBe(0o755)
  })

  it('agrees with itself: every directory it creates private, it also checks', () => {
    const checked = new Map(REPAIR_MODES.map((entry) => [entry.path, entry.mode]))
    for (const { path, mode } of REPAIR_DIRECTORIES) {
      if (mode !== 0o700) continue
      expect(checked.get(path), path).toBe(mode)
    }
  })

  it('covers every file that holds a secret', () => {
    const paths = REPAIR_MODES.map((entry) => entry.path)
    expect(paths).toContain('.env')
    expect(paths).toContain('state/traefik/acme/acme.json')
    expect(paths).toContain('state/cloudflared/credentials.json')
    for (const { path, mode } of REPAIR_MODES) {
      if (path.endsWith('.json') || path === '.env') expect(mode, path).toBe(0o600)
    }
  })
})

describe('humanSize', () => {
  it('reads like du -h', () => {
    expect(humanSize(512)).toBe('512B')
    expect(humanSize(2048)).toBe('2.0K')
    expect(humanSize(5 * 1024 * 1024)).toBe('5.0M')
  })
})
