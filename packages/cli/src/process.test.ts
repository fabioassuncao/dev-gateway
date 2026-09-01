import { describe, expect, it } from 'vitest'
import { PROCESS_POLICY, runProcess } from './process.js'

describe('process execution', () => {
  it('forbids shell command construction by policy', () => expect(PROCESS_POLICY).toEqual({ shell: false, argumentArraysOnly: true }))
  it('passes metacharacters as data', async () => {
    const marker = `portta-${Date.now()}`
    const result = await runProcess(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', `; touch /tmp/${marker}`])
    expect(result.stdout).toBe(`; touch /tmp/${marker}`)
  })
})
