// Runtime configuration for the panel.
//
// Every value the panel reports comes from the same environment Compose was
// invoked with, so the panel and the CLI always describe the same gateway.
// Defaults mirror `dg_defaults` in scripts/lib/common.sh: keep them in sync.

import { readFileSync, existsSync } from 'node:fs'

const truthy = new Set(['1', 'true', 'yes', 'on', 'enabled'])

export function isTrue(value: string | undefined | null): boolean {
  return truthy.has(String(value ?? '').trim().toLowerCase())
}

function env(key: string, fallback: string): string {
  const value = process.env[key]
  return value === undefined || value === '' ? fallback : value
}

function optional(key: string): string | null {
  const value = process.env[key]
  return value === undefined || value === '' ? null : value
}

export interface PanelConfig {
  /** Docker Engine API base URL, always the panel's own socket proxy. */
  dockerApi: string
  host: string
  port: number
  envFile: string
  versionFile: string
  uiDir: string
  profile: string
  projectName: string
  network: string
  controlNetwork: string
  accessNetwork: string
  webNetwork: string
  domain: string
  privateDomain: string | null
  publicDomain: string | null
  bindAddress: string
  httpPort: string
  httpsPort: string
  tlsEnabled: boolean
  tlsMode: string
  acmeEmailSet: boolean
  acmeCaServer: string
  acmeDnsProvider: string
  tailscaleEnabled: boolean
  tailscaleHostname: string
  publicEnabled: boolean
  cloudflareEnabled: boolean
  cloudflareZone: string | null
  dashboardEnabled: boolean
  dashboardBindAddress: string
  dashboardPort: string
  tcpEnabled: boolean
  tcpPorts: Record<string, number>
  bridgeImage: string
  /** How long to wait before checking a new bridge actually stayed up. */
  bridgeSettleMs: number
  panelVersion: string
  gatewayVersion: string
  /** Read-only mode refuses every mutating endpoint. */
  readOnly: boolean
}

export function loadConfig(overrides: Partial<PanelConfig> = {}): PanelConfig {
  const versionFile = env('DG_WEB_VERSION_FILE', '/app/state/VERSION')
  const config: PanelConfig = {
    dockerApi: env('DG_WEB_DOCKER_API', 'http://web-socket-proxy:2375'),
    host: env('DG_WEB_HOST', '0.0.0.0'),
    port: Number(env('DG_WEB_PORT', '8081')),
    envFile: env('DG_WEB_ENV_FILE', '/app/state/.env'),
    versionFile,
    uiDir: env('DG_WEB_UI_DIR', './dist/ui'),
    profile: env('DEV_GATEWAY_PROFILE', 'local'),
    projectName: env('DEV_GATEWAY_PROJECT_NAME', 'dev-gateway'),
    network: env('DEV_GATEWAY_NETWORK', 'dev-gateway'),
    controlNetwork: env('DEV_GATEWAY_CONTROL_NETWORK', 'dev-gateway-control'),
    accessNetwork: env('DEV_GATEWAY_ACCESS_NETWORK', 'dev-gateway-access'),
    webNetwork: env('DEV_GATEWAY_WEB_NETWORK', 'dev-gateway-web'),
    domain: env('DEV_GATEWAY_DOMAIN', 'localhost'),
    privateDomain: optional('PRIVATE_DOMAIN'),
    publicDomain: optional('PUBLIC_DOMAIN'),
    bindAddress: env('DEV_GATEWAY_BIND_ADDRESS', '127.0.0.1'),
    httpPort: env('DEV_GATEWAY_HTTP_PORT', '80'),
    httpsPort: env('DEV_GATEWAY_HTTPS_PORT', '443'),
    tlsEnabled: isTrue(process.env.TLS_ENABLED),
    tlsMode: env('TLS_MODE', 'local'),
    acmeEmailSet: Boolean(optional('ACME_EMAIL')),
    acmeCaServer: env('ACME_CA_SERVER', 'https://acme-v02.api.letsencrypt.org/directory'),
    acmeDnsProvider: env('ACME_DNS_PROVIDER', 'cloudflare'),
    tailscaleEnabled: isTrue(process.env.TAILSCALE_ENABLED),
    tailscaleHostname: env('TAILSCALE_HOSTNAME', 'dev-gateway'),
    publicEnabled: isTrue(process.env.PUBLIC_ENABLED),
    cloudflareEnabled: isTrue(process.env.CLOUDFLARE_ENABLED),
    cloudflareZone: optional('CLOUDFLARE_ZONE'),
    dashboardEnabled: isTrue(process.env.DEV_GATEWAY_DASHBOARD),
    dashboardBindAddress: env('DEV_GATEWAY_DASHBOARD_BIND_ADDRESS', '127.0.0.1'),
    dashboardPort: env('DEV_GATEWAY_DASHBOARD_PORT', '8080'),
    // Pinned in scripts/lib/discovery.sh; the panel must create the very same
    // bridge the CLI creates, or `dev-gateway access list` would not see it.
    tcpEnabled: isTrue(process.env.DEV_GATEWAY_TCP),
    tcpPorts: {
      postgres: Number(env('DEV_GATEWAY_TCP_POSTGRES_PORT', '5432')),
      redis: Number(env('DEV_GATEWAY_TCP_REDIS_PORT', '6379')),
    },
    bridgeImage: env('DG_WEB_BRIDGE_IMAGE', 'alpine/socat:1.8.1.3'),
    bridgeSettleMs: Number(env('DG_WEB_BRIDGE_SETTLE_MS', '800')),
    panelVersion: env('DG_WEB_VERSION', '0.1.0'),
    gatewayVersion: readVersion(versionFile),
    readOnly: isTrue(process.env.DG_WEB_READ_ONLY),
    ...overrides,
  }
  return config
}

function readVersion(file: string): string {
  try {
    if (!existsSync(file)) return 'unknown'
    return readFileSync(file, 'utf8').trim() || 'unknown'
  } catch {
    return 'unknown'
  }
}

/** The scheme Traefik answers on, given the resolved TLS settings. */
export function schemeFor(config: PanelConfig): 'http' | 'https' {
  return config.tlsEnabled ? 'https' : 'http'
}
