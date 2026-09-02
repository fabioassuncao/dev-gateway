import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { capabilitiesFrom, capabilityById, emptyFacts } from 'portta-core'

const runProcess = vi.fn()
const locate = vi.fn()

vi.mock('./process.js', () => ({ runProcess }))
vi.mock('./host.js', async (original) => ({
  ...(await original<typeof import('./host.ts')>()),
  locate,
  privateAddresses: () => ['192.168.1.20'],
}))

const { detectFacts, tailscaleFacts, tunnelConfigured } = await import('./detect.ts')

function ok(stdout: string) {
  return { stdout, stderr: '', exitCode: 0, failed: false }
}
function fails() {
  return { stdout: '', stderr: '', exitCode: 1, failed: true }
}

beforeEach(() => {
  runProcess.mockReset()
  locate.mockReset()
  locate.mockResolvedValue(null)
  runProcess.mockResolvedValue(fails())
})

describe('tailscaleFacts', () => {
  it('reports nothing installed when the binary is not on the host', async () => {
    expect(await tailscaleFacts()).toEqual({
      installed: false, connected: false, ipv4: null, magicDns: null, httpsCerts: false, funnel: false, tagged: false,
    })
  })

  it('reports installed but not connected when the daemon is stopped', async () => {
    locate.mockResolvedValue('/usr/bin/tailscale')
    runProcess.mockResolvedValue(ok(JSON.stringify({ BackendState: 'Stopped' })))
    const facts = await tailscaleFacts()
    expect(facts.installed).toBe(true)
    expect(facts.connected).toBe(false)
  })

  it('survives output that is not JSON at all', async () => {
    locate.mockResolvedValue('/usr/bin/tailscale')
    runProcess.mockResolvedValue(ok('not json'))
    expect((await tailscaleFacts()).connected).toBe(false)
  })

  it('reads the address, the MagicDNS name, certificates, funnel and tags', async () => {
    locate.mockResolvedValue('/usr/bin/tailscale')
    const status = {
      BackendState: 'Running',
      Self: {
        // The trailing dot is part of the DNS name, not the URL.
        DNSName: 'vps.tail1234.ts.net.',
        CertDomains: ['vps.tail1234.ts.net'],
        Tags: ['tag:server'],
        CapMap: { 'https://tailscale.com/cap/funnel': [] },
      },
    }
    runProcess.mockImplementation(async (_file: string, args: string[]) =>
      args[0] === 'status' ? ok(JSON.stringify(status)) : ok('100.87.243.7\n'))

    expect(await tailscaleFacts()).toEqual({
      installed: true,
      connected: true,
      ipv4: '100.87.243.7',
      magicDns: 'vps.tail1234.ts.net',
      httpsCerts: true,
      funnel: true,
      tagged: true,
    })
  })

  it('does not claim certificates or funnel from an ordinary node', async () => {
    locate.mockResolvedValue('/usr/bin/tailscale')
    runProcess.mockImplementation(async (_file: string, args: string[]) =>
      args[0] === 'status' ? ok(JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'laptop.tail1234.ts.net.' } })) : ok('100.1.2.3'))
    const facts = await tailscaleFacts()
    expect(facts.httpsCerts).toBe(false)
    expect(facts.funnel).toBe(false)
    expect(facts.tagged).toBe(false)
  })
})

describe('tunnelConfigured', () => {
  it('needs both the configuration and the credentials, never one of them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'portta-detect-'))
    try {
      mkdirSync(join(dir, 'cloudflared'))
      expect(tunnelConfigured(dir)).toBe(false)
      writeFileSync(join(dir, 'cloudflared/config.yml'), '')
      expect(tunnelConfigured(dir)).toBe(false)
      writeFileSync(join(dir, 'cloudflared/credentials.json'), '{}')
      expect(tunnelConfigured(dir)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('detectFacts', () => {
  const stateDir = '/nowhere'

  it('emits every field portta-core declares, and no other', async () => {
    const facts = await detectFacts({ env: {}, stateDir })
    const expected = emptyFacts()
    expect(Object.keys(facts).sort()).toEqual(Object.keys(expected).sort())
    expect(Object.keys(facts.tailscale).sort()).toEqual(Object.keys(expected.tailscale).sort())
    expect(Object.keys(facts.cloudflare).sort()).toEqual(Object.keys(expected.cloudflare).sort())
  })

  // PORTTA_PUBLIC_IP is "the address the automatic domain encodes", which on a
  // tailnet-only host is a CGNAT address. Reporting that as public is the exact
  // conflation the capability model exists to undo.
  it('refuses to call a CGNAT or RFC 1918 address public', async () => {
    expect((await detectFacts({ env: { PORTTA_PUBLIC_IP: '100.87.243.7' }, stateDir })).publicIpv4).toBeNull()
    expect((await detectFacts({ env: { PORTTA_PUBLIC_IP: '192.168.1.20' }, stateDir })).publicIpv4).toBeNull()
    expect((await detectFacts({ env: { PORTTA_PUBLIC_IP: '203.0.113.10' }, stateDir })).publicIpv4).toBe('203.0.113.10')
  })

  it('reports a custom domain only in custom mode', async () => {
    expect((await detectFacts({ env: { PORTTA_DOMAIN_MODE: 'custom', PORTTA_DOMAIN: 'dev.example.test' }, stateDir })).customDomain)
      .toBe('dev.example.test')
    expect((await detectFacts({ env: { PORTTA_DOMAIN_MODE: 'local', PORTTA_DOMAIN: 'dev.example.test' }, stateDir })).customDomain)
      .toBeNull()
  })

  it('records that an Access policy exists without reading or creating one', async () => {
    const facts = await detectFacts({ env: { CLOUDFLARE_ACCESS_ENABLED: 'true', CLOUDFLARE_TUNNEL_ZONE: 'example.com' }, stateDir })
    expect(facts.cloudflare.accessConfigured).toBe(true)
    expect(facts.cloudflare.zone).toBe('example.com')
  })

  it('cannot report a tunnel connected when it is not even configured', async () => {
    const facts = await detectFacts({ env: {}, stateDir })
    expect(facts.cloudflare.tunnelConfigured).toBe(false)
    expect(facts.cloudflare.tunnelConnected).toBe(false)
  })
})

// ADR 0024: detection is one half of a contract whose other half is pure.
// These probes are only worth anything if the verdicts read them correctly.
describe('the detected facts and the core verdicts are one contract', () => {
  const state = async (env: Record<string, string>, id: Parameters<typeof capabilityById>[1]) => {
    const facts = await detectFacts({ env, stateDir: '/nowhere' })
    return capabilityById(capabilitiesFrom(facts), id)?.state
  }

  it('a detected public address makes the automatic domain available', async () => {
    expect(await state({ PORTTA_PUBLIC_IP: '203.0.113.10' }, 'auto-domain')).toBe('available')
    expect(await state({ PORTTA_PUBLIC_IP: '203.0.113.10' }, 'localhost')).toBe('available')
  })

  it('a tailnet-only host has neither a public address nor a public automatic domain', async () => {
    expect(await state({ PORTTA_DOMAIN_MODE: 'auto', PORTTA_PUBLIC_IP: '100.87.243.7' }, 'auto-domain')).toBe('unavailable')
    expect(await state({ PORTTA_DOMAIN_MODE: 'auto', PORTTA_PUBLIC_IP: '100.87.243.7' }, 'public-ipv4')).toBe('unavailable')
  })
})
