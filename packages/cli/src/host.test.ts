import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('node:os', async (original) => {
  const actual = await original<typeof import('node:os')>()
  return { ...actual, networkInterfaces: () => interfaces }
})

// A host running Docker has one 172.x gateway per network. Offering
// `web.172-18-0-1.sslip.io` as a LAN endpoint would be noise at best, so the
// interface name is what decides, not the address.
let interfaces: ReturnType<typeof import('node:os').networkInterfaces> = {}

const { fileMode, isPrivateAddress, privateAddresses } = await import('./host.ts')

describe('isPrivateAddress', () => {
  it('covers RFC 1918, loopback, link-local and the CGNAT range', () => {
    for (const address of ['10.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.1.20', '127.0.0.1', '169.254.1.1', '100.87.243.7']) {
      expect(isPrivateAddress(address), address).toBe(true)
    }
  })

  it('does not swallow the ranges either side of 172.16/12', () => {
    expect(isPrivateAddress('172.15.0.1')).toBe(false)
    expect(isPrivateAddress('172.32.0.1')).toBe(false)
  })

  it('calls a routable address public', () => {
    expect(isPrivateAddress('203.0.113.10')).toBe(false)
    expect(isPrivateAddress('8.8.8.8')).toBe(false)
  })

  it('refuses anything that is not four octets', () => {
    expect(isPrivateAddress('')).toBe(false)
    expect(isPrivateAddress('10.0.0')).toBe(false)
    expect(isPrivateAddress('10.0.0.256')).toBe(false)
    expect(isPrivateAddress('not-an-address')).toBe(false)
  })
})

describe('privateAddresses', () => {
  const entry = (address: string, internal = false) => ({
    address, netmask: '255.255.255.0', family: 'IPv4' as const, mac: '00:00:00:00:00:00', internal, cidr: `${address}/24`,
  })

  it('keeps real private networks and drops every bridge', () => {
    interfaces = {
      eth0: [entry('192.168.1.20')],
      eth1: [entry('10.8.0.4')],
      docker0: [entry('172.17.0.1')],
      'br-9f2': [entry('172.18.0.1')],
      tailscale0: [entry('100.87.243.7')],
      lo: [entry('127.0.0.1', true)],
    }
    expect(privateAddresses().sort()).toEqual(['10.8.0.4', '192.168.1.20'])
  })

  // The tailnet address has its own capability; listing it here as well would
  // offer one network twice under two names.
  it('never reports the tailnet address as a LAN, whatever the interface is called', () => {
    interfaces = { eth0: [entry('100.87.243.7')] }
    expect(privateAddresses()).toEqual([])
  })

  it('leaves out a public address, which is a different capability', () => {
    interfaces = { eth0: [entry('203.0.113.10')] }
    expect(privateAddresses()).toEqual([])
  })
})

describe('fileMode', () => {
  it('reports four octal digits, so a private key can be judged', () => {
    const dir = mkdtempSync(join(tmpdir(), 'portta-host-'))
    try {
      const file = join(dir, 'app.pem')
      writeFileSync(file, 'key')
      chmodSync(file, 0o600)
      expect(fileMode(file)).toBe('0600')
      chmodSync(file, 0o644)
      expect(fileMode(file)).toBe('0644')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('answers null rather than throwing for a file that is not there', () => {
    expect(fileMode('/definitely/not/a/file')).toBeNull()
  })
})
