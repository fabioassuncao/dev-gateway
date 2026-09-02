import { resolveDomain, type DomainMode } from './domain.ts'

export const TRUTHY = new Set(['1', 'true', 'yes', 'on', 'enabled'])

export function isTrue(value: string | undefined | null): boolean {
  return TRUTHY.has(String(value ?? '').trim().toLowerCase())
}

export type GatewayProfile = 'local' | 'remote-private' | 'remote-public'

/**
 * How the panel is reached. Deliberately independent of the gateway profile:
 * publishing the panel must never publish an application, so `public` here is
 * not `remote-public` there. See docs/adr/0021-panel-access-modes.md.
 *
 *   local      loopback only; reach it over an SSH tunnel
 *   tailscale  bound to the node's tailnet address, nothing on the public NIC
 *   public     Traefik's own `panel` entrypoint on every interface, BasicAuth
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
  if (!['local', 'remote-private', 'remote-public'].includes(profile)) throw new Error(`unknown profile: ${profile}`)
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
 * The overlays live under docker/compose/, one directory per axis of the decision.
 * Must stay in step with portta_compose_files in scripts/lib/docker.sh: the shell
 * gateway and this CLI are two implementations of the same contract.
 */
export function composeFiles(config: GatewayConfig): string[] {
  const attachment = config.profile !== 'local' && config.tailscaleEnabled ? 'tailscale' : 'host'
  const files = ['docker/compose/compose.yaml', `docker/compose/attach/${attachment}.yaml`]
  if (config.profile === 'local') {
    files.push('docker/compose/profiles/local.yaml')
    if (config.tlsEnabled && config.tlsMode === 'local') files.push('docker/compose/profiles/local-tls.yaml')
  } else {
    // Redirecting :80 to :443 without a certificate the browser accepts turns a
    // working URL into a warning page, so the TLS overlay is applied only when
    // there is TLS. See docs/adr/0022-project-domain-modes.md.
    files.push(config.tlsEnabled ? 'docker/compose/profiles/remote-tls.yaml' : 'docker/compose/profiles/remote.yaml')
  }
  if (config.profile === 'remote-public') files.push('docker/compose/profiles/public.yaml')
  if (config.dashboardEnabled) files.push(attachment === 'tailscale' ? 'docker/compose/features/dashboard-tailscale.yaml' : 'docker/compose/features/dashboard.yaml')
  if (config.tcpEnabled) files.push(attachment === 'tailscale' ? 'docker/compose/features/tcp-tailscale.yaml' : 'docker/compose/features/tcp.yaml')
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
  // Last, and independent of every other axis: the connector is an extra way in,
  // never a replacement for one. A gateway can carry a tunnel while still
  // publishing ports, or while publishing none at all.
  if (config.tunnelEnabled) files.push('docker/compose/features/cloudflare-tunnel.yaml')
  return files
}
