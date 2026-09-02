import { describe, expect, it } from 'vitest'
import { TUNNEL_STATES, tunnelStatusFrom } from 'portta-core'
import { cliHint, describeProbe, tunnelContainer, tunnelPaths } from './tunnel.ts'

describe('tunnelPaths', () => {
  it('keeps the credential and the config in one owner-only directory', () => {
    const paths = tunnelPaths('/opt/portta')
    expect(paths.directory).toBe('/opt/portta/state/cloudflared')
    expect(paths.config).toBe('/opt/portta/state/cloudflared/config.yml')
    expect(paths.credentials).toBe('/opt/portta/state/cloudflared/credentials.json')
  })
})

describe('tunnelContainer', () => {
  it('follows the Compose project name, so two gateways on one host do not collide', () => {
    expect(tunnelContainer({})).toBe('portta-cloudflared-1')
    expect(tunnelContainer({ PORTTA_PROJECT_NAME: 'staging' })).toBe('staging-cloudflared-1')
    expect(tunnelContainer({ PORTTA_PROJECT_NAME: '' })).toBe('portta-cloudflared-1')
  })
})

describe('describeProbe', () => {
  // 404 is the success case, and the least obvious thing about this command:
  // a name nothing routes to, answered by Traefik, proves the whole path
  // without needing a live service to exist.
  it('reads 404 as proof the whole path works', () => {
    const verdict = describeProbe(404)
    expect(verdict.ok).toBe(true)
    expect(verdict.detail).toContain('carrying traffic')
    expect(verdict.detail).toContain('404 is correct here')
  })

  it('accepts 200 and any redirect', () => {
    for (const code of [200, 301, 302, 307]) expect(describeProbe(code).ok).toBe(true)
  })

  it('tells the Cloudflare-side failure from the gateway-side one', () => {
    expect(describeProbe(530).detail).toContain('no connector')
    expect(describeProbe(530).hint).toBe('portta tunnel status')
    expect(describeProbe(502).detail).toContain('could not reach the gateway')
    expect(describeProbe(504).ok).toBe(false)
  })

  it('says nothing answered rather than inventing a code', () => {
    expect(describeProbe(0).detail).toBe('no answer at all')
  })
})

describe('cliHint', () => {
  const status = (state: (typeof TUNNEL_STATES)[number]) => ({ state, detail: '', hint: 'Settings -> Cloudflare Tunnel' })

  // The shared verdict is written for the panel, whose hints name panel pages.
  // A reader in a terminal needs the command.
  it('replaces the panel wording with a command for every actionable state', () => {
    expect(cliHint(status('not-configured'))).toBe('portta tunnel setup --zone <domain>')
    expect(cliHint(status('configured'))).toBe('portta tunnel enable')
    expect(cliHint(status('config-error'))).toBe('portta tunnel logs')
    expect(cliHint(status('auth-error'))).toContain('portta tunnel setup')
    expect(cliHint(status('disconnected'))).toContain('portta tunnel logs')
  })

  it('never leaves a panel page name in a terminal hint', () => {
    for (const state of TUNNEL_STATES) {
      const hint = cliHint(status(state))
      if (hint) expect(hint).not.toContain('Settings ->')
    }
  })

  it('says nothing when the shared verdict has nothing to add', () => {
    expect(cliHint({ state: 'connected', detail: '', hint: null })).toBeNull()
  })
})

// The command reads its inputs from Docker and the filesystem; the verdict
// itself is core's. This is the join: every state the command can print comes
// from an input shape the command actually produces.
describe('every state the command can print is reachable from what it observes', () => {
  const base = { tokenConfigured: true, zoneConfigured: true, enabled: true, containerState: 'running', containerHealth: null, logTail: '' }

  it('covers the whole enumeration', () => {
    const reached = new Set([
      tunnelStatusFrom({ ...base, tokenConfigured: false }).state,
      tunnelStatusFrom({ ...base, enabled: false }).state,
      tunnelStatusFrom({ ...base, logTail: 'Unauthorized' }).state,
      tunnelStatusFrom({ ...base, logTail: "Couldn't start tunnel" }).state,
      tunnelStatusFrom({ ...base, containerState: null }).state,
      tunnelStatusFrom({ ...base, logTail: 'Registered tunnel connection 0' }).state,
      tunnelStatusFrom({ ...base, containerHealth: 'starting' }).state,
    ])
    expect([...reached].sort()).toEqual([...TUNNEL_STATES].sort())
  })
})
