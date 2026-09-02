import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { resolveDomain, type DomainMode } from './domain.ts'

export const AUTH_BUILD_FILE = 'docker/compose/features/auth-build.yaml'
export const LOCAL_PORTA_IMAGE = 'fabioassuncao/portta:local'

/** A checkout has the Dockerfiles; PORTTA_HOME does not. */
export function isCheckoutSource(root: string): boolean {
  return existsSync(join(root, 'apps/web/Dockerfile')) && existsSync(join(root, 'apps/auth'))
}

export const TRUTHY = new Set(['1', 'true', 'yes', 'on', 'enabled'])

export function isTrue(value: string | undefined | null): boolean {
  return TRUTHY.has(String(value ?? '').trim().toLowerCase())
}

/** The three profiles, as one list so nothing has to restate them. */
export const GATEWAY_PROFILES = ['local', 'remote-private', 'remote-public'] as const
export type GatewayProfile = (typeof GATEWAY_PROFILES)[number]

export function isGatewayProfile(value: string): value is GatewayProfile {
  return (GATEWAY_PROFILES as readonly string[]).includes(value)
}

/**
 * How the panel is reached. Deliberately independent of the gateway profile:
 * publishing the panel must never publish an application, so `public` here is
 * not `remote-public` there. See docs/adr/0021-panel-access-modes.md.
 *
 *   local      loopback only; reach it over an SSH tunnel
 *   tailscale  bound to the node's tailnet address, nothing on the public NIC
 *   public     Traefik's own `panel` entrypoint on every interface, ForwardAuth
 *   vpn        routed by Traefik at PORTTA_WEB_HOST.<domain> (remote-private)
 */
export const PANEL_ACCESS_MODES = ['local', 'tailscale', 'public', 'vpn'] as const
export type PanelAccess = (typeof PANEL_ACCESS_MODES)[number]

export function isPanelAccess(value: string): value is PanelAccess {
  return (PANEL_ACCESS_MODES as readonly string[]).includes(value)
}

export interface GatewayConfig {
  profile: GatewayProfile
  projectName: string
  network: string
  controlNetwork: string
  accessNetwork: string
  webNetwork: string
  databaseNetwork: string
  domain: string
  bindAddress: string
  httpPort: number
  httpsPort: number
  tlsEnabled: boolean
  tlsMode: string
  /** 'dns' issues one wildcard and needs a provider credential; 'http' issues per hostname and needs :80. */
  acmeChallenge: string
  tailscaleEnabled: boolean
  publicEnabled: boolean
  publicDomain: string | null
  privateDomain: string | null
  dashboardEnabled: boolean
  tcpEnabled: boolean
  webEnabled: boolean
  webDev: boolean
  webBuild: boolean
  webExpose: PanelAccess
  /** How the base domain was chosen, and what it could not honour. */
  domainMode: DomainMode
  domainProblem: string | null
  publicIp: string | null
  webPort: number
  webReadOnly: boolean
  /** Whether the Cloudflare Tunnel connector runs beside the gateway. */
  tunnelEnabled: boolean
  /** The zone whose wildcard the tunnel carries, when one is configured. */
  tunnelZone: string | null
}

function value(env: Record<string, string | undefined>, key: string, fallback: string): string {
  return env[key] || fallback
}

function optional(env: Record<string, string | undefined>, key: string): string | null {
  return env[key] || null
}

export function loadGatewayConfig(env: Record<string, string | undefined> = process.env): GatewayConfig {
  const profile = value(env, 'PORTTA_PROFILE', 'local')
  if (!isGatewayProfile(profile)) throw new Error(`unknown profile: ${profile}`)
  const webExpose = value(env, 'PORTTA_WEB_EXPOSE', 'local')
  if (!isPanelAccess(webExpose)) throw new Error(`unknown panel access mode: ${webExpose}`)
  const publicDomain = optional(env, 'PUBLIC_DOMAIN')
  const privateDomain = optional(env, 'PRIVATE_DOMAIN')

  // The base every project hostname is built on, from the mode rather than a
  // bare value. `custom` keeps PORTTA_DOMAIN as the value it always was, so an
  // installation that predates the modes resolves exactly as before.
  const domainMode = value(env, 'PORTTA_DOMAIN_MODE', 'local')
  const resolution = resolveDomain({
    mode: domainMode,
    publicIp: optional(env, 'PORTTA_PUBLIC_IP'),
    provider: optional(env, 'PORTTA_AUTO_DOMAIN_PROVIDER'),
    configured: optional(env, 'PORTTA_DOMAIN'),
  })
  let domain = resolution.domain
  let bindAddress = value(env, 'PORTTA_BIND_ADDRESS', '127.0.0.1')

  // The per-profile domains stay what they were: a wildcard the operator owns
  // for that audience. An auto or custom base fills in where one is unset, so
  // going public no longer means buying a domain first.
  if (profile === 'remote-private') domain = privateDomain ?? domain
  if (profile === 'remote-public') {
    const effective = publicDomain ?? (resolution.mode === 'local' ? null : resolution.domain)
    if (!effective) {
      throw new Error('profile remote-public requires PUBLIC_DOMAIN, or a project domain mode that yields one')
    }
    domain = effective
    bindAddress = '0.0.0.0'
  }
  // The `public` panel entrypoint is a port on the Traefik container. Under the
  // Tailscale attachment Traefik has no network namespace of its own, so there
  // is no port to publish and the mode cannot be honoured.
  if (webExpose === 'public' && profile !== 'local' && isTrue(env['TAILSCALE_ENABLED'])) {
    throw new Error('panel access `public` is not available while Traefik runs inside the Tailscale namespace')
  }
  return {
    profile: profile as GatewayProfile,
    projectName: value(env, 'PORTTA_PROJECT_NAME', 'portta'),
    network: value(env, 'PORTTA_NETWORK', 'portta'),
    controlNetwork: value(env, 'PORTTA_CONTROL_NETWORK', 'portta-control'),
    accessNetwork: value(env, 'PORTTA_ACCESS_NETWORK', 'portta-access'),
    webNetwork: value(env, 'PORTTA_WEB_NETWORK', 'portta-web'),
    databaseNetwork: value(env, 'PORTTA_DB_NETWORK', 'portta-data'),
    domain,
    bindAddress,
    httpPort: Number(value(env, 'PORTTA_HTTP_PORT', '80')),
    httpsPort: Number(value(env, 'PORTTA_HTTPS_PORT', '443')),
    tlsEnabled: isTrue(env['TLS_ENABLED']),
    tlsMode: value(env, 'TLS_MODE', 'local'),
    acmeChallenge: value(env, 'ACME_CHALLENGE', 'dns'),
    tailscaleEnabled: isTrue(env['TAILSCALE_ENABLED']),
    publicEnabled: isTrue(env['PUBLIC_ENABLED']),
    publicDomain,
    privateDomain,
    dashboardEnabled: isTrue(env['PORTTA_DASHBOARD']),
    tcpEnabled: isTrue(env['PORTTA_TCP']),
    webEnabled: isTrue(env['PORTTA_WEB']),
    webDev: isTrue(env['PORTTA_WEB_DEV']),
    webBuild: isTrue(env['PORTTA_WEB_BUILD']),
    webExpose,
    domainMode: resolution.mode,
    domainProblem: resolution.problem,
    publicIp: optional(env, 'PORTTA_PUBLIC_IP'),
    webPort: Number(value(env, 'PORTTA_WEB_PORT', '8081')),
    webReadOnly: isTrue(env['PORTTA_WEB_READ_ONLY']),
    tunnelEnabled: isTrue(env['CLOUDFLARE_TUNNEL_ENABLED']),
    tunnelZone: optional(env, 'CLOUDFLARE_TUNNEL_ZONE'),
  }
}

/**
 * How Traefik is attached to the network, which decides both the overlay set
 * and where Traefik's API answers.
 *
 * With docker/compose/attach/host.yaml Traefik has its own namespace and is
 * reachable as `traefik`. With docker/compose/attach/tailscale.yaml it runs
 * inside the Tailscale container's namespace and has no name of its own, so
 * the same API answers on `tailscale`. See
 * docs/adr/0007-tailscale-sidecar.md.
 */
export function attachment(config: { profile: string; tailscaleEnabled: boolean }): 'tailscale' | 'host' {
  return config.profile !== 'local' && config.tailscaleEnabled ? 'tailscale' : 'host'
}

/**
 * The overlays live under docker/compose/, one directory per axis of the decision.
 *
 * `portta_compose_files` in scripts/lib/docker.sh is the zero-Node fallback's
 * implementation of the same contract, not a second source of truth: ADR 0015
 * requires `up`, `down`, `status` and `doctor` to work with no Node on the
 * host. The two are held together by the parity assertions in
 * tests/unit/profiles.test.sh, which run both and compare the file lists and
 * the resolved domain across every profile and domain mode.
 */
export function composeFiles(config: GatewayConfig): string[] {
  const attached = attachment(config)
  const files = ['docker/compose/compose.yaml', `docker/compose/attach/${attached}.yaml`]
  if (config.profile === 'local') {
    files.push('docker/compose/profiles/local.yaml')
    if (config.tlsEnabled && config.tlsMode === 'local') files.push('docker/compose/profiles/local-tls.yaml')
  } else {
    // Redirecting :80 to :443 without a certificate the browser accepts turns a
    // working URL into a warning page, so the TLS overlay is applied only when
    // there is TLS. See docs/adr/0022-project-domain-modes.md.
    if (config.tlsEnabled) {
      // Exactly one challenge overlay rides with the shared TLS one. DNS-01 is
      // the default because it is the only challenge that issues a wildcard,
      // and the only one a private gateway can use at all; HTTP-01 is the
      // trade for a public host that would rather not hold a DNS credential.
      files.push('docker/compose/profiles/remote-tls.yaml')
      files.push(config.acmeChallenge === 'http'
        ? 'docker/compose/profiles/remote-tls-http.yaml'
        : 'docker/compose/profiles/remote-tls-dns.yaml')
    } else files.push('docker/compose/profiles/remote.yaml')
  }
  if (config.profile === 'remote-public') files.push('docker/compose/profiles/public.yaml')
  if (config.dashboardEnabled) files.push(attached === 'tailscale' ? 'docker/compose/features/dashboard-tailscale.yaml' : 'docker/compose/features/dashboard.yaml')
  if (config.tcpEnabled) files.push(attached === 'tailscale' ? 'docker/compose/features/tcp-tailscale.yaml' : 'docker/compose/features/tcp.yaml')
  if (config.webEnabled) {
    files.push('docker/compose/features/web.yaml', 'docker/compose/features/db.yaml')
    // Exactly one overlay owns the panel's front door, so `public` and a host
    // publish can never both claim PORTTA_WEB_PORT.
    if (config.webExpose === 'public') files.push('docker/compose/features/panel-public.yaml')
    else files.push('docker/compose/features/web-bind.yaml')
    if (config.webBuild) files.push('docker/compose/features/web-build.yaml')
    if (config.webDev) files.push('docker/compose/features/web-dev.yaml')
    if (config.webExpose === 'vpn') files.push('docker/compose/features/web-vpn.yaml')
  }
  // Auth is a gateway service, not a panel extra: the migrator runs on `up`
  // even when the panel is off. The overlay is selected by the local-build
  // flags here; a checkout appends it in composeFilesForRoot.
  if (config.webBuild || config.webDev) files.push(AUTH_BUILD_FILE)
  // Last, and independent of every other axis: the connector is an extra way in,
  // never a replacement for one. A gateway can carry a tunnel while still
  // publishing ports, or while publishing none at all.
  if (config.tunnelEnabled) files.push('docker/compose/features/cloudflare-tunnel.yaml')
  return files
}

const TUNNEL_FILE = 'docker/compose/features/cloudflare-tunnel.yaml'

/** Overlays for this root: the env-selected set, plus auth-build in a checkout. */
export function composeFilesForRoot(config: GatewayConfig, root: string): string[] {
  const files = composeFiles(config)
  if (!isCheckoutSource(root) || files.includes(AUTH_BUILD_FILE)) return files
  const tunnel = files.indexOf(TUNNEL_FILE)
  if (tunnel === -1) return [...files, AUTH_BUILD_FILE]
  return [...files.slice(0, tunnel), AUTH_BUILD_FILE, ...files.slice(tunnel)]
}
