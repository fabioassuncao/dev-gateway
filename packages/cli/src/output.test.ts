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
})
