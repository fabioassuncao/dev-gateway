import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Output } from '../output.js'

const mocks = vi.hoisted(() => ({
  collectHostSnapshot: vi.fn(),
  gatewayContext: vi.fn(),
}))
vi.mock('../host.js', () => ({ collectHostSnapshot: mocks.collectHostSnapshot }))
vi.mock('../context.js', () => ({ gatewayContext: mocks.gatewayContext }))

import { collectHostResources, refreshHostResources } from './host.js'

const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  mocks.collectHostSnapshot.mockReset()
  mocks.gatewayContext.mockReset()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tree(): string {
  const root = mkdtempSync(join(tmpdir(), 'portta-host-'))
  roots.push(root)
  return root
}

describe('host collection', () => {
  it('writes one file the panel can read, and nothing else', async () => {
    const root = tree()
    mocks.collectHostSnapshot.mockResolvedValue({
      collectedAt: 1_700_000_000,
      uptimeSeconds: 3600,
      load: { one: 0.2, five: 0.1, fifteen: 0.05 },
      cpu: { model: 'Test CPU', utilisation: 0.1 },
      memory: { totalBytes: 8, availableBytes: 4, usedBytes: 4 },
      storage: [],
      gpu: [],
    })

    const file = await collectHostResources(root)
    expect(file).toBe(join(root, 'state/host/host.json'))
    expect(existsSync(file)).toBe(true)
    const written = JSON.parse(readFileSync(file, 'utf8')) as { cpu: { model: string } }
    expect(written.cpu.model).toBe('Test CPU')
  })

  it('keeps an automatic refresh non-fatal', async () => {
    mocks.gatewayContext.mockImplementation(() => {
      throw new Error('no gateway here')
    })
    let stderr = ''
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr += String(chunk)
      return true
    })

    await expect(refreshHostResources(undefined, new Output())).resolves.toBeUndefined()
    expect(stderr).toContain('warning: Host resources could not be collected: no gateway here')
  })
})
