import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ spawnDetached: vi.fn() }))
vi.mock('../process.js', () => ({ spawnDetached: mocks.spawnDetached }))

import { collectorRunning, pidAlive, readCollectorPid, startCollector, writePid } from './lifecycle.ts'

const roots: string[] = []
afterEach(() => {
  mocks.spawnDetached.mockReset()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tree(): string {
  const root = mkdtempSync(join(tmpdir(), 'portta-collector-'))
  roots.push(root)
  return root
}

describe('collector lifecycle', () => {
  it('treats a dead pid file as stopped', () => {
    const root = tree()
    writePid(root, 999_999_999)
    expect(pidAlive(999_999_999)).toBe(false)
    expect(collectorRunning(root)).toBeNull()
    expect(readCollectorPid(root)).toBeNull()
  })

  it('does not start a second collector when one is already this process', () => {
    const root = tree()
    writePid(root, process.pid)
    mocks.spawnDetached.mockReturnValue(123)
    const result = startCollector(root)
    expect(result).toEqual({ pid: process.pid, started: false })
    expect(mocks.spawnDetached).not.toHaveBeenCalled()
  })

  it('starts once after clearing a stale pid', () => {
    const root = tree()
    writePid(root, 888_888_888)
    mocks.spawnDetached.mockReturnValue(4242)
    const result = startCollector(root)
    expect(result).toEqual({ pid: 4242, started: true })
    expect(readCollectorPid(root)).toBe(4242)
  })
})
