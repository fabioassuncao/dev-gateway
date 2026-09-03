import { describe, expect, it, vi } from 'vitest'
import { Output } from './output.js'

describe('output', () => {
  it('keeps JSON on stdout and progress on stderr', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const output = new Output({ json: true })
    output.progress('working')
    output.data({ ok: true })
    expect(stdout).toHaveBeenCalledWith('{\n  "ok": true\n}\n')
    expect(stderr).toHaveBeenCalledWith('working\n')
    stdout.mockRestore(); stderr.mockRestore()
  })

  it('announces a phase on stderr, never on stdout', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    new Output({}).step('gateway components')
    expect(stdout).not.toHaveBeenCalled()
    expect(stderr).toHaveBeenCalledWith('\n:: gateway components\n')
    stdout.mockRestore(); stderr.mockRestore()
  })

  it('says nothing about a phase under --quiet or --json', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    new Output({ quiet: true }).step('gateway components')
    new Output({ json: true }).step('gateway components')
    expect(stderr).not.toHaveBeenCalled()
    stderr.mockRestore()
  })
})
