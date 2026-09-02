import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { makeApp } from './helpers.ts'
import { GATEWAY } from './fixtures.ts'
import type { HostResources } from '../../src/shared/types.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function hostDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'portta-host-'))
  dirs.push(dir)
  return dir
}

describe('GET /api/host', () => {
  it('still answers with only the Engine facts when nothing was collected', async () => {
    const dir = hostDir()
    const { app } = makeApp({ containers: GATEWAY }, { hostDir: dir })
    const body = (await (await app.request('/api/host')).json()) as HostResources
    expect(body.system.hostname).toBe('test-host')
    expect(body.system.os).toBe('Test Linux')
    expect(body.cpu.cores).toBe(8)
    expect(body.memory.totalBytes).toBe(17_179_869_184)
    expect(body.memory.usedBytes).toBeNull()
    expect(body.gpu).toEqual([])
    expect(body.hint).toBe('portta host collect')
    expect(body.collectedAt).toBeNull()
  })

  it('merges the collected file and flags a stale snapshot', async () => {
    const dir = hostDir()
    writeFileSync(join(dir, 'host.json'), JSON.stringify({
      collectedAt: 1_000,
      uptimeSeconds: 3600,
      load: { one: 0.4, five: 0.3, fifteen: 0.2 },
      cpu: { model: 'Test CPU', utilisation: 0.12 },
      memory: { totalBytes: 16, availableBytes: 4, usedBytes: 12 },
      storage: [{
        path: '/var/lib/docker',
        role: 'both',
        totalBytes: 100,
        usedBytes: 90,
        availableBytes: 10,
      }],
      gpu: [{
        name: 'RTX 4090',
        memoryTotalBytes: 24,
        memoryUsedBytes: 4,
        utilisation: 0.3,
      }],
    }))
    const { app } = makeApp({ containers: GATEWAY }, { hostDir: dir, hostStaleSeconds: 60 })
    const body = (await (await app.request('/api/host')).json()) as HostResources
    expect(body.system.uptimeSeconds).toBe(3600)
    expect(body.cpu.model).toBe('Test CPU')
    expect(body.memory.usedPercent).toBeCloseTo(0.75)
    expect(body.storage[0]?.role).toBe('both')
    expect(body.gpu[0]?.name).toBe('RTX 4090')
    expect(body.stale).toBe(true)
    expect(body.hint).toBeNull()
  })

  it('treats a malformed file as not collected', async () => {
    const dir = hostDir()
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'host.json'), '{broken\n')
    const { app } = makeApp({ containers: GATEWAY }, { hostDir: dir })
    const body = (await (await app.request('/api/host')).json()) as HostResources
    expect(body.collectedAt).toBeNull()
    expect(body.hint).toBe('portta host collect')
    expect(body.system.hostname).toBe('test-host')
  })
})
