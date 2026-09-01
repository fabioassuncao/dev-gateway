export const TRUTHY = new Set(['1', 'true', 'yes', 'on', 'enabled'])

export function isTrue(value: string | undefined | null): boolean {
  return TRUTHY.has(String(value ?? '').trim().toLowerCase())
}

export type GatewayProfile = 'local' | 'remote-private' | 'remote-public'

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
  webExpose: string
  webPort: number
  webReadOnly: boolean
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
  const publicDomain = optional(env, 'PUBLIC_DOMAIN')
  const privateDomain = optional(env, 'PRIVATE_DOMAIN')
  let domain = value(env, 'PORTTA_DOMAIN', 'localhost')
  let bindAddress = value(env, 'PORTTA_BIND_ADDRESS', '127.0.0.1')
  if (profile === 'remote-private' && privateDomain) domain = privateDomain
  if (profile === 'remote-public') {
    if (!publicDomain) throw new Error('profile remote-public requires PUBLIC_DOMAIN')
    domain = publicDomain
    bindAddress = '0.0.0.0'
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
    webExpose: value(env, 'PORTTA_WEB_EXPOSE', 'local'),
    webPort: Number(value(env, 'PORTTA_WEB_PORT', '8081')),
    webReadOnly: isTrue(env['PORTTA_WEB_READ_ONLY']),
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
  } else files.push('docker/compose/profiles/remote.yaml')
  if (config.profile === 'remote-public') files.push('docker/compose/profiles/public.yaml')
  if (config.dashboardEnabled) files.push(attachment === 'tailscale' ? 'docker/compose/features/dashboard-tailscale.yaml' : 'docker/compose/features/dashboard.yaml')
  if (config.tcpEnabled) files.push(attachment === 'tailscale' ? 'docker/compose/features/tcp-tailscale.yaml' : 'docker/compose/features/tcp.yaml')
  if (config.webEnabled) {
    files.push('docker/compose/features/web.yaml', 'docker/compose/features/db.yaml')
    if (config.webDev) files.push('docker/compose/features/web-dev.yaml')
    if (config.webExpose === 'vpn') files.push('docker/compose/features/web-vpn.yaml')
  }
  return files
}
