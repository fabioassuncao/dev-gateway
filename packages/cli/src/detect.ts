// Gathering the facts the capability model reasons about.
//
// This file only ever *observes*. It never runs `tailscale up`, never
// authenticates a tunnel, and never changes a bind address. Turning something
// on is a separate, deliberate act; see
// docs/adr/0024-capabilities-providers-endpoints.md.
//
// The verdicts — which facts add up to which capability state — are pure and
// live in `capabilitiesFrom` in portta-core, so the same evidence yields the
// same answer wherever it is read. This is the probe half, and it is here
// rather than in core because core must not execute processes.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { emptyFacts, isTrue, type DetectedFacts, type TailscaleFacts } from 'portta-core'
import { isPrivateAddress, locate, privateAddresses } from './host.js'
import { runProcess } from './process.js'

const CLOUDFLARED_IMAGE = 'cloudflare/cloudflared:2026.8.3'

/**
 * Read-only, always. Portta reports what the tailnet allows and never changes
 * it: `tailscale up`, the HTTPS-certificates switch and the policy file are the
 * operator's, and a gateway that edited them would be doing something nobody
 * asked for. See docs/tailscale.md.
 */
export async function tailscaleFacts(): Promise<TailscaleFacts> {
  const absent: TailscaleFacts = { installed: false, connected: false, ipv4: null, magicDns: null, httpsCerts: false, funnel: false, tagged: false }
  const binary = await locate('tailscale')
  if (!binary) return absent

  const status = await runProcess(binary, ['status', '--json'], { reject: false })
  if (status.failed || !status.stdout.trim()) return { ...absent, installed: true }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(status.stdout) as Record<string, unknown>
  } catch {
    return { ...absent, installed: true }
  }
  if (parsed['BackendState'] !== 'Running') return { ...absent, installed: true }

  const ip = await runProcess(binary, ['ip', '-4'], { reject: false })
  const self = (parsed['Self'] ?? {}) as Record<string, unknown>

  return {
    installed: true,
    connected: true,
    ipv4: ip.failed ? null : (ip.stdout.trim().split('\n')[0] || null),
    // The trailing dot Tailscale reports is part of the DNS name, not the URL.
    magicDns: typeof self['DNSName'] === 'string' ? self['DNSName'].replace(/\.$/, '') : null,
    // Whether the tailnet issues certificates cannot be read from status
    // directly: the capability is granted per tailnet and only shows up once
    // something has asked for a certificate.
    httpsCerts: Array.isArray(self['CertDomains']) && self['CertDomains'].length > 0,
    // Funnel is granted through the policy file as a node attribute, and shows
    // up in the node's capability map.
    funnel: JSON.stringify(parsed['Self'] ?? {}).includes('tailscale.com/cap/funnel'),
    // Tailscale Services require a tagged node; a user-owned node is refused
    // with "service hosts must be tagged nodes".
    tagged: Array.isArray(self['Tags']) && self['Tags'].length > 0,
  }
}

/**
 * A connector this host can actually run: either a binary on the host or the
 * image already pulled. Portta prefers the container
 * (docs/adr/0025-cloudflare-tunnel.md) because everything else it runs is a
 * container, but an operator who already runs cloudflared under systemd keeps
 * it and Portta stays out of the way.
 */
export async function cloudflaredAvailable(image = CLOUDFLARED_IMAGE): Promise<boolean> {
  if (await locate('cloudflared')) return true
  const inspect = await runProcess('docker', ['image', 'inspect', image], { reject: false })
  return !inspect.failed
}

export function tunnelConfigured(stateDir: string): boolean {
  return existsSync(join(stateDir, 'cloudflared/config.yml')) && existsSync(join(stateDir, 'cloudflared/credentials.json'))
}

/**
 * Whether the connector holds registered connections.
 *
 * Asked of the container on this host rather than of Cloudflare, so the answer
 * is about this machine and needs no credentials to obtain.
 */
export async function tunnelConnected(projectName = 'portta'): Promise<boolean> {
  const container = `${projectName}-cloudflared-1`
  const running = await runProcess('docker', ['inspect', '-f', '{{.State.Running}}', container], { reject: false })
  if (running.failed || running.stdout.trim() !== 'true') return false

  const info = await runProcess('docker', ['exec', container, 'cloudflared', 'tunnel', 'info'], { reject: false })
  if (!info.failed) return true
  // `tunnel info` needs credentials the container may not carry; the line the
  // connector prints on every successful registration is the fallback.
  const logs = await runProcess('docker', ['logs', '--tail', '200', container], { reject: false })
  return `${logs.stdout}${logs.stderr}`.includes('Registered tunnel connection')
}

export interface DetectOptions {
  env: Record<string, string | undefined>
  stateDir: string
  projectName?: string
}

/**
 * Everything above, in the shape portta-core consumes.
 *
 * `PORTTA_PUBLIC_IP` is "the address the automatic domain encodes", which on a
 * host reached only over the tailnet is deliberately a CGNAT address. That is
 * not a public address, and reporting it as one is the exact conflation this
 * model exists to undo: a tailnet address is a *private* capability, and
 * `auto-domain` must not claim the internet can reach it.
 */
export async function detectFacts(options: DetectOptions): Promise<DetectedFacts> {
  const { env, stateDir } = options
  const tailscale = await tailscaleFacts()

  const connectorAvailable = await cloudflaredAvailable()
  const configured = connectorAvailable && tunnelConfigured(stateDir)
  const connected = configured && (await tunnelConnected(options.projectName ?? env['PORTTA_PROJECT_NAME'] ?? 'portta'))

  const declared = env['PORTTA_PUBLIC_IP'] ?? ''
  const publicIpv4 = declared && !isPrivateAddress(declared) ? declared : null

  return {
    ...emptyFacts(),
    publicIpv4,
    privateIpv4: privateAddresses(),
    tailscale,
    cloudflare: {
      connectorAvailable,
      tunnelConfigured: configured,
      tunnelConnected: connected,
      // Access is Cloudflare-side state. Portta records that the operator told
      // it a policy exists; it never creates, reads or assumes one.
      accessConfigured: isTrue(env['CLOUDFLARE_ACCESS_ENABLED']),
      zone: env['CLOUDFLARE_TUNNEL_ZONE'] || null,
    },
    customDomain: env['PORTTA_DOMAIN_MODE'] === 'custom' ? (env['PORTTA_DOMAIN'] || null) : null,
    resolvedDomain: env['PORTTA_DOMAIN'] || 'localhost',
    tlsEnabled: isTrue(env['TLS_ENABLED']),
    bindAddress: env['PORTTA_BIND_ADDRESS'] || '127.0.0.1',
  }
}
