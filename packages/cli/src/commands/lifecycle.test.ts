import { describe, expect, it } from 'vitest'
import { LOCAL_PORTA_IMAGE } from 'portta-core'
import { authMigrationRunArguments, checkoutLocalEnv, doctorReport, type Check } from './lifecycle.js'

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

describe('checkout development images', () => {
  it('never points Portta images at the published registry', () => {
    const values = checkoutLocalEnv()
    expect(values.PORTTA_AUTH_IMAGE).toBe(LOCAL_PORTA_IMAGE)
    expect(values.PORTTA_WEB_IMAGE).toBe(LOCAL_PORTA_IMAGE)
    expect(Object.values(values).join(' ')).not.toContain('ghcr.io/fabioassuncao')
    expect(values.PORTTA_WEB_BUILD).toBe('true')
    expect(values.PORTTA_WEB_DEV).toBe('true')
  })
})

describe('authentication state migration', () => {
  it('targets the isolated disposable writer as the host user', () => {
    expect(authMigrationRunArguments(true, '501:20')).toEqual([
      'run', '--rm', '--no-deps', '--build', '--user', '501:20',
      'portta-auth-migrate',
    ])
  })

  it('does not invent a Unix user on platforms that do not expose one', () => {
    expect(authMigrationRunArguments(false)).not.toContain('--user')
  })
})
