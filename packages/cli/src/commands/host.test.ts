import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptySnapshot } from 'portta-core'
import { Output } from '../output.js'

const mocks = vi.hoisted(() => ({
  collectSnapshot: vi.fn(),
  gatewayContext: vi.fn(),
  startCollector: vi.fn(),
}))
vi.mock('../metrics/collect.js', () => ({ collectSnapshot: mocks.collectSnapshot }))
vi.mock('../context.js', () => ({ gatewayContext: mocks.gatewayContext }))
vi.mock('../metrics/lifecycle.js', async () => {
  const actual = await vi.importActual<typeof import('../metrics/lifecycle.js')>('../metrics/lifecycle.js')
  return { ...actual, startCollector: mocks.startCollector }
})

import { collectHostResources, ensureMetricsCollector } from './host.js'

const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  mocks.collectSnapshot.mockReset()
  mocks.gatewayContext.mockReset()
  mocks.startCollector.mockReset()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tree(): string {
  const root = mkdtempSync(join(tmpdir(), 'portta-host-'))
  roots.push(root)
  return root
}

describe('host collection', () => {
  it('writes current.json and nothing else', async () => {
    const root = tree()
    mocks.collectSnapshot.mockResolvedValue(emptySnapshot({ id: 'i', name: 'box', hostname: 'box' }, 1_700_000_000))

    const file = await collectHostResources(root)
    expect(file).toBe(join(root, 'state/metrics/current.json'))
    expect(existsSync(file)).toBe(true)
    const written = JSON.parse(readFileSync(file, 'utf8')) as { version: number; instance: { id: string } }
    expect(written.version).toBe(1)
    expect(written.instance.id).toBe('i')
  })

  it('keeps an automatic collector start non-fatal', async () => {
    mocks.gatewayContext.mockImplementation(() => {
      throw new Error('no gateway here')
    })
    let stderr = ''
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr += String(chunk)
      return true
    })

    await expect(ensureMetricsCollector(undefined, new Output())).resolves.toBeUndefined()
    expect(stderr).toContain('warning: Host metrics collector could not start: no gateway here')
  })
})
