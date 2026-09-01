// Runtime configuration for the panel.
//
// Every value the panel reports comes from the same environment Compose was
// invoked with, so the panel and the CLI always describe the same gateway.
// Gateway-wide defaults are owned by @dev-gateway/core.

import { readFileSync, existsSync } from 'node:fs'
import { isTrue, loadGatewayConfig } from '@dev-gateway/core'

export { isTrue }

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
  /** Private network shared only by the panel and its PostgreSQL database. */
  databaseNetwork: string
  /** Bootstrap connection string. Null keeps persistence entirely optional. */
  databaseUrl: string | null
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
  /** Serve the self-contained API browser. The OpenAPI document is always served. */
  apiDocs: boolean
  /** Where the panel can be reached from: `local` or `vpn`. */
  webExpose: string
  /** `none`, or `basic` for a Traefik BasicAuth middleware on its own router. */
  webAuth: string
  webAuthUser: string
  /**
   * The apr1/bcrypt hash guarding the panel. Never leaves this process: the API
   * reports whether it is set, the same way it treats TS_AUTHKEY.
   */
  webAuthHash: string
  /** Traefik's dynamic configuration directory, mounted read-write. */
  dynamicDir: string
  /** Where `dev-gateway git scan` writes, mounted read-only. */
  gitDir: string
  /** Past this age, collected Git metadata is marked stale rather than shown. */
  gitStaleSeconds: number
  /** Traefik's own API, resolved per attachment. Read-only, and opt-in. */
  traefikApi: string
  traefikApiTtlMs: number
  traefikApiTimeoutMs: number
  /** Off by default: with this false the panel behaves exactly as it did. */
  githubEnabled: boolean
  githubAppId: string
  /** A path, never the PEM: the panel can write .env, and must not hold a key. */
  githubPrivateKeyFile: string
  /** Configurable from the first commit, so Enterprise Server is not a rewrite. */
  githubWebhookSecret: string
  githubApiUrl: string
  githubTimeoutMs: number
}

export function loadConfig(overrides: Partial<PanelConfig> = {}): PanelConfig {
  const versionFile = env('DG_WEB_VERSION_FILE', '/app/state/VERSION')
  const gateway = loadGatewayConfig(process.env)
  const config: PanelConfig = {
    dockerApi: env('DG_WEB_DOCKER_API', 'http://web-socket-proxy:2375'),
    host: env('DG_WEB_HOST', '0.0.0.0'),
    port: Number(env('DG_WEB_PORT', '8081')),
    envFile: env('DG_WEB_ENV_FILE', '/app/state/.env'),
    versionFile,
    uiDir: env('DG_WEB_UI_DIR', './dist/ui'),
    profile: gateway.profile,
    projectName: gateway.projectName,
    network: gateway.network,
    controlNetwork: gateway.controlNetwork,
    accessNetwork: gateway.accessNetwork,
    webNetwork: gateway.webNetwork,
    databaseNetwork: gateway.databaseNetwork,
    databaseUrl: optional('DG_WEB_DATABASE_URL'),
    domain: gateway.domain,
    privateDomain: gateway.privateDomain,
    publicDomain: gateway.publicDomain,
    bindAddress: gateway.bindAddress,
    httpPort: String(gateway.httpPort),
    httpsPort: String(gateway.httpsPort),
    tlsEnabled: gateway.tlsEnabled,
    tlsMode: gateway.tlsMode,
    acmeEmailSet: Boolean(optional('ACME_EMAIL')),
    acmeCaServer: env('ACME_CA_SERVER', 'https://acme-v02.api.letsencrypt.org/directory'),
    acmeDnsProvider: env('ACME_DNS_PROVIDER', 'cloudflare'),
    tailscaleEnabled: gateway.tailscaleEnabled,
    tailscaleHostname: env('TAILSCALE_HOSTNAME', 'dev-gateway'),
    publicEnabled: gateway.publicEnabled,
    cloudflareEnabled: isTrue(process.env.CLOUDFLARE_ENABLED),
    cloudflareZone: optional('CLOUDFLARE_ZONE'),
    dashboardEnabled: gateway.dashboardEnabled,
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
    apiDocs: false,
    webExpose: env('DEV_GATEWAY_WEB_EXPOSE', 'local'),
    webAuth: env('DEV_GATEWAY_WEB_AUTH', 'none'),
    webAuthUser: env('DEV_GATEWAY_WEB_AUTH_USER', ''),
    webAuthHash: env('DEV_GATEWAY_WEB_AUTH_HASH', ''),
    dynamicDir: env('DG_WEB_DYNAMIC_DIR', '/app/state/traefik-dynamic'),
    gitDir: env('DG_WEB_GIT_DIR', '/app/state/git'),
    gitStaleSeconds: Number(env('DG_WEB_GIT_STALE_SECONDS', '600')),
    traefikApi: env('DG_WEB_TRAEFIK_API', defaultTraefikApi()),
    traefikApiTtlMs: Number(env('DG_WEB_TRAEFIK_API_TTL_MS', '7000')),
    traefikApiTimeoutMs: Number(env('DG_WEB_TRAEFIK_API_TIMEOUT_MS', '1500')),
    githubEnabled: isTrue(process.env.GITHUB_APP_ENABLED),
    githubAppId: env('GITHUB_APP_ID', ''),
    githubPrivateKeyFile: env('GITHUB_APP_PRIVATE_KEY_FILE', '/app/state/github/app.pem'),
    githubWebhookSecret: env('GITHUB_APP_WEBHOOK_SECRET', ''),
    githubApiUrl: env('GITHUB_API_URL', 'https://api.github.com'),
    githubTimeoutMs: Number(env('DG_WEB_GITHUB_TIMEOUT_MS', '8000')),
    ...overrides,
  }
  if (overrides.apiDocs === undefined) {
    const configured = optional('DG_WEB_API_DOCS')
    config.apiDocs = configured === null ? !isRouted(config) : isTrue(configured)
  }
  return config
}

/**
 * Where Traefik's API answers, which depends on how Traefik is attached.
 *
 * With compose.attach-host.yaml Traefik has its own namespace and is reachable
 * as `traefik`. With compose.attach-tailscale.yaml it runs inside the Tailscale
 * container's namespace and has no name of its own, so the same API answers on
 * `tailscale` ([ADR 0007](docs/adr/0007-tailscale-sidecar.md)). The internal
 * port is always 8080; only the published one is configurable.
 *
 * Mirrors dg_attachment in scripts/lib/docker.sh: keep them in sync.
 */
function defaultTraefikApi(): string {
  const profile = env('DEV_GATEWAY_PROFILE', 'local')
  const attached = profile !== 'local' && isTrue(process.env.TAILSCALE_ENABLED) ? 'tailscale' : 'traefik'
  return `http://${attached}:8080`
}

function readVersion(file: string): string {
  try {
    if (!existsSync(file)) return 'unknown'
    return readFileSync(file, 'utf8').trim() || 'unknown'
  } catch {
    return 'unknown'
  }
}

/** True when the panel is reachable beyond the host's own loopback. */
export function isRouted(config: PanelConfig): boolean {
  return config.webExpose !== 'local'
}

/** True when a routed panel is sitting behind Traefik BasicAuth. */
export function isAuthenticated(config: PanelConfig): boolean {
  return config.webAuth === 'basic' && config.webAuthUser !== '' && config.webAuthHash !== ''
}

/** The scheme Traefik answers on, given the resolved TLS settings. */
export function schemeFor(config: PanelConfig): 'http' | 'https' {
  return config.tlsEnabled ? 'https' : 'http'
}
