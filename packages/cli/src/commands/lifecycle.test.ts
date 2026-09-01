import { describe, expect, it } from 'vitest'
import { doctorReport, type Check } from './lifecycle.js'

describe('what doctor prints', () => {
  it('offers a fix only for a check that did not pass', () => {
    const checks: Check[] = [
      { id: 'env', status: 'pass', message: '.env exists', fix: 'copy .env.example to .env' },
      { id: 'network', status: 'fail', message: 'shared network portta', fix: 'run portta bootstrap' },
    ]
    expect(doctorReport(checks)).toEqual([
      { line: 'ok   .env exists' },
      { line: 'FAIL shared network portta', hint: 'run portta bootstrap' },
    ])
  })

  it('says nothing extra when a failing check has no known fix', () => {
    expect(doctorReport([{ id: 'x', status: 'fail', message: 'something' }])).toEqual([
      { line: 'FAIL something' },
    ])
  })
})
