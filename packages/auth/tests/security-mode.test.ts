// The one decision made from the environment, and the two it refuses to make.

import { describe, expect, it } from 'vitest'
import { ConfigError, resolveSecurityMode, trustedOrigins, useSecureCookies } from '../src/security-mode.ts'

const env = (values: Record<string, string> = {}): NodeJS.ProcessEnv => values

describe('the security mode', () => {
  it('is open by default, which is only safe on loopback', () => {
    const security = resolveSecurityMode(env())
    expect(security.mode).toBe('open')
    expect(security.bindAddress).toBe('127.0.0.1')
  })

  // Reaching a loopback panel already means having the machine. Reaching one on
  // 0.0.0.0 does not, so "no authentication" there is an open door — refused at
  // boot rather than warned about, because a warning in a log nobody reads is
  // the same as no warning.
  it('refuses open mode on an address that is not loopback', () => {
    expect(() => resolveSecurityMode(env({ PORTTA_WEB_BIND_ADDRESS: '0.0.0.0' }))).toThrow(ConfigError)
    expect(() => resolveSecurityMode(env({ PORTTA_WEB_BIND_ADDRESS: '0.0.0.0' }))).toThrow(/only allowed on loopback/)
  })

  it('refuses open mode on a panel that is exposed at all', () => {
    expect(() => resolveSecurityMode(env({ PORTTA_WEB_EXPOSE: 'vpn' }))).toThrow(/only allowed on loopback/)
  })

  it('refuses protected mode with no secret to sign sessions with', () => {
    expect(() => resolveSecurityMode(env({ PORTTA_AUTH_MODE: 'required' }))).toThrow(/PORTTA_AUTH_SECRET is required/)
  })

  it('refuses a mode nothing names', () => {
    expect(() => resolveSecurityMode(env({ PORTTA_AUTH_MODE: 'maybe' }))).toThrow(/must be disabled or required/)
  })

  it('accepts protected mode with a secret', () => {
    const security = resolveSecurityMode(env({ PORTTA_AUTH_MODE: 'required', PORTTA_AUTH_SECRET: 'x'.repeat(32) }))
    expect(security.mode).toBe('protected')
    expect(security.secret).toHaveLength(32)
  })
})

describe('the origins a browser may write from', () => {
  it('names the panel and both loopback spellings on its port, never a wildcard', () => {
    const security = resolveSecurityMode(env({ PORTTA_WEB_PORT: '8081' }))
    expect(trustedOrigins(security)).toEqual([
      'http://127.0.0.1:8081',
      'http://127.0.0.1:8081',
      'http://localhost:8081',
    ])
  })

  it('adds the ones the operator configured', () => {
    const security = resolveSecurityMode(
      env({
        PORTTA_AUTH_MODE: 'required',
        PORTTA_AUTH_SECRET: 'x',
        PORTTA_WEB_EXPOSE: 'vpn',
        PORTTA_PANEL_URL: 'https://portta.example.com',
        PORTTA_PANEL_TRUSTED_ORIGINS: 'https://vpn.example.com, https://other.example.com',
      }),
    )
    expect(trustedOrigins(security)).toContain('https://vpn.example.com')
    expect(trustedOrigins(security)).toContain('https://other.example.com')
  })
})

describe('the session cookie', () => {
  // `Secure` on plain HTTP means the browser drops the cookie and nobody can
  // sign in; off under HTTPS means it travels where it should not.
  it('is secure under https and not under plain loopback http', () => {
    const https = resolveSecurityMode(
      env({ PORTTA_AUTH_MODE: 'required', PORTTA_AUTH_SECRET: 'x', PORTTA_WEB_EXPOSE: 'vpn', PORTTA_PANEL_URL: 'https://portta.example.com' }),
    )
    expect(useSecureCookies(https)).toBe(true)
    expect(useSecureCookies(resolveSecurityMode(env()))).toBe(false)
  })
})

describe('read-only mode', () => {
  it('is read from the runtime flag the rest of the panel already uses', () => {
    expect(resolveSecurityMode(env({ PORTTA_RUNTIME_READ_ONLY: 'true' })).readOnly).toBe(true)
    expect(resolveSecurityMode(env()).readOnly).toBe(false)
  })
})
