// The contract between the API and the UI. Everything here is derived from
// Docker and the gateway's own configuration at request time: the panel keeps
// no second source of truth.

export type Ownership = 'gateway' | 'integrated' | 'external' | 'standalone'

/** Brand or runtime identity behind a container, used to pick a panel icon. */
export interface ServiceTech {
  /** Stable key used to pick an icon, e.g. `postgres`, `nginx`, `docker`. */
  id: string
  /** Short human label shown next to the icon. */
  label: string
}

export type ContainerState =
  | 'created'
  | 'running'
  | 'paused'
  | 'restarting'
  | 'removing'
  | 'exited'
  | 'dead'

export type Health = 'healthy' | 'unhealthy' | 'starting' | 'none'

export type UrlScope = 'local' | 'vpn' | 'public'

/** Whether a TCP protocol can be told apart by hostname on a shared port. */
export type TcpRouting = 'starttls-sni' | 'tls-sni' | 'unsupported' | 'unevaluated'

export type ServiceKind =
  | 'http'
  | 'postgres'
  | 'mysql'
  | 'redis'
  | 'mongodb'
  | 'memcached'
  | 'search'
  | 'amqp'
  | 'clickhouse'
  | 'smtp'
  | 'tcp'

export interface PublishedPort {
  ip: string
  hostPort: number
  containerPort: number
  protocol: string
}

export interface RouteUrl {
  url: string
  host: string
  scope: UrlScope
  scheme: 'http' | 'https'
}

export interface MountSummary {
  type: string
  name: string | null
  source: string
  destination: string
  rw: boolean
}

export interface ContainerSummary {
  id: string
  name: string
  image: string
  state: ContainerState
  status: string
  health: Health
  createdAt: number
  startedAt: number | null
  uptimeSeconds: number | null
  ownership: Ownership
  gatewayComponent: string | null
  project: string | null
  service: string | null
  workingDir: string | null
  namespace: string | null
  /** `dev-gateway.project`: the logical project several worktrees share. */
  group: string | null
  /** `dev-gateway.repo`: `owner/name` or a remote URL, as the project wrote it. */
  repo: string | null
  /** The repository's web address, derived from `repo` by string work alone. */
  repoUrl: string | null
  /** `dev-gateway.git.root`, when the Compose file is not at the repo root. */
  gitRoot: string | null
  networks: string[]
  onGatewayNetwork: boolean
  traefikEnabled: boolean
  ports: PublishedPort[]
  exposedPorts: number[]
  kind: ServiceKind
  /** Brand/runtime identity for the panel icon. Never replaces the name. */
  tech: ServiceTech
  urls: RouteUrl[]
  mounts: MountSummary[]
  labels: Record<string, string>
  restartCount: number
  exitCode: number | null
}

export interface Project {
  name: string
  integrated: boolean
  workingDir: string | null
  namespace: string | null
  /** All four are null unless the project declared them. Never required. */
  group: string | null
  repo: string | null
  repoUrl: string | null
  gitRoot: string | null
  services: ContainerSummary[]
  serviceCount: number
  runningCount: number
  healthyCount: number
  unhealthyCount: number
  networks: string[]
  urls: RouteUrl[]
  scopes: UrlScope[]
  startedAt: number | null
  uptimeSeconds: number | null
}

export interface GitHead {
  sha: string
  shortSha: string
  subject: string
  author: string
  /** Unix seconds. */
  date: number
}

export interface GitInfo {
  /** Null on a detached HEAD, which `detached` then explains. */
  branch: string | null
  detached: boolean
  head: GitHead
  staged: number
  unstaged: number
  untracked: number
  unmerged: number
  dirty: boolean
  upstream: string | null
  ahead: number
  behind: number
  /** The remote URL as Git reports it, or the `dev-gateway.repo` label. */
  remote: string | null
}

export interface ForgePullRequest {
  number: number
  title: string
  state: string
  draft: boolean
  reviewDecision: string | null
  checks: string | null
  url: string | null
  headRefName: string | null
}

export interface Forge {
  kind: string
  collectedAt: number
  /** False when `gh` was present but not signed in. */
  authenticated: boolean
  reason: string | null
  pulls: ForgePullRequest[]
}

/**
 * What `dev-gateway git scan` collected for one project, as the panel reads it.
 * Everything is optional by design: no Git, no remote, no `gh` and no scan at
 * all are four different absences, and each renders as fewer sections rather
 * than an error.
 */
export interface ProjectGit {
  project: string
  /** Whether a file exists at all. False means nobody has run a scan. */
  collected: boolean
  collectedAt: number | null
  ageSeconds: number | null
  stale: boolean
  staleAfterSeconds: number
  workingDir: string | null
  git: GitInfo | null
  remote: { url: string; host: string; slug: string; kind: string; repoUrl: string } | null
  links: { repo: string | null; commit: string | null; branch: string | null }
  forge: Forge | null
  /** Why there is no Git here, when the collector could say. */
  reason: string | null
  /** The exact host command that refreshes this. The panel never runs it. */
  refreshCommand: string
}

/** One router as Traefik itself reports it, not as the labels imply. */
export interface TraefikRouter {
  name: string
  rule: string
  /** Every Host(`...`) the rule names, lowercased. */
  hosts: string[]
  entryPoints: string[]
  middlewares: string[]
  service: string
  provider: string
  /** Traefik's own verdict: `enabled`, `disabled`, or `warning`. */
  status: string
  /** Traefik's own error text when it rejected the router. */
  errors: string[]
  /** The backends Traefik resolved for this router's service. */
  servers: string[]
}

export interface TraefikVerdict {
  /** False when the API is off or unreachable. Not the same as "no problem". */
  available: boolean
  reason: string | null
  baseUrl: string
  dashboardUrl: string | null
  routers: TraefikRouter[]
  fetchedAt: number
}

/** What Traefik says about one service, beside what its labels say. */
export interface ServiceTraefik {
  containerId: string
  available: boolean
  reason: string | null
  /** Hostnames the panel derived from the labels, for comparison. */
  expectedHosts: string[]
  routers: (TraefikRouter & { dashboardUrl: string | null })[]
  fetchedAt: number
}

/** Three states per service, and `private` is the absence of a share. */
export type ShareMode = 'public' | 'protected'
export type ShareState = 'active' | 'expired' | 'dangling'

export interface Share {
  id: string
  project: string
  service: string
  /** The container the router points at, by name: aliases are not unique. */
  container: string
  port: number
  host: string
  url: string
  mode: ShareMode
  /** The username, for a protected share. The password is never here. */
  user: string | null
  createdAt: number
  expiresAt: number
  expiresInSeconds: number
  state: ShareState
}

export interface ShareView {
  shares: Share[]
  /** Where shared hostnames live, kept visibly apart from project ones. */
  domain: string
  /** Whether a `public` share would be accepted at all. */
  publicAllowed: boolean
  maxTtlSeconds: number
}

export interface Diagnostic {
  id: string
  status: 'pass' | 'warn' | 'fail'
  title: string
  detail: string
  fix: string
}

export interface GatewayStatus {
  gatewayVersion: string
  panelVersion: string
  profile: string
  domain: string
  privateDomain: string | null
  publicDomain: string | null
  bindAddress: string
  httpPort: string
  httpsPort: string
  scheme: 'http' | 'https'
  up: boolean
  reachable: boolean
  tls: { enabled: boolean; mode: string }
  tailscale: { enabled: boolean; running: boolean; hostname: string }
  publicAccess: { enabled: boolean; domain: string | null }
  /** The panel's own exposure and front door. Never carries the hash. */
  panel: {
    expose: string
    routed: boolean
    auth: string
    authenticated: boolean
    user: string
    readOnly: boolean
  }
  dashboard: { enabled: boolean; bindAddress: string; port: string }
  traefik: { containerId: string | null; state: ContainerState | 'absent'; health: Health }
  socketProxy: { containerId: string | null; state: ContainerState | 'absent' }
  network: { name: string; exists: boolean; attached: number; internal: boolean }
  routes: number
}

export interface OverviewCounts {
  projects: number
  integratedProjects: number
  services: number
  servicesRunning: number
  servicesHealthy: number
  servicesUnhealthy: number
  containersTotal: number
  containersRunning: number
  containersGateway: number
  containersIntegrated: number
  containersExternal: number
  containersStandalone: number
  bridges: number
  forwarders: number
  routes: number
  shares: number
  /** Shares that expired or whose target container is gone. */
  sharesStale: number
}

export interface Overview {
  gateway: GatewayStatus
  counts: OverviewCounts
  urls: RouteUrl[]
  problems: Diagnostic[]
  generatedAt: number
}

export interface NetworkSummary {
  id: string
  name: string
  driver: string
  scope: string
  internal: boolean
  containerCount: number
  managed: boolean
  role: 'shared' | 'control' | 'access' | 'project' | 'other'
}

export interface PortUsage {
  hostPort: number
  protocol: string
  bindings: { ip: string; containerId: string; containerName: string; ownership: Ownership; containerPort: number }[]
  conflict: boolean
}

export interface DockerHost {
  engine: {
    version: string
    apiVersion: string
    os: string
    arch: string
    cpus: number
    memoryBytes: number
    name: string
  }
  containers: { total: number; running: number; paused: number; stopped: number }
  byOwnership: { gateway: number; integrated: number; external: number; standalone: number }
  networks: NetworkSummary[]
  ports: PortUsage[]
}

export interface Bridge {
  id: string
  containerId: string
  project: string
  service: string
  targetPort: number
  localPort: number | null
  bindIp: string
  kind: ServiceKind
  network: string
  createdAt: number | null
  expiresAt: number | null
  state: ContainerState | 'absent'
  connectionString: string
}

export interface Forwarder {
  alias: string
  containerId: string
  project: string
  service: string
  port: number
  kind: ServiceKind
  state: ContainerState | 'absent'
  networks: string[]
}

export interface TcpService {
  containerId: string
  project: string
  service: string
  image: string
  kind: ServiceKind
  tech: ServiceTech
  state: ContainerState
  health: Health
  ports: number[]
  defaultPort: number | null
  publishedPorts: PublishedPort[]
  privateNetworks: string[]
  bridge: Bridge | null
  forwarder: Forwarder | null
  integrated: boolean
  /** How, or whether, this protocol can be reached by hostname. */
  routing: TcpRouting
  /** True when the container carries the TCP router labels that opt it in. */
  routed: boolean
  /** `<project>-<service>.<domain>:<port>`, when the gateway is serving it. */
  gatewayAddress: string | null
  gatewayConnectionString: string | null
}

export interface AccessView {
  services: TcpService[]
  bridges: Bridge[]
  forwarders: Forwarder[]
  bridgeImageHint: string
  /** Whether the gateway is publishing the TCP entrypoints at all. */
  tcpRoutingEnabled: boolean
}

export interface NetworkView {
  gateway: GatewayStatus
  domains: {
    local: string
    private: string | null
    public: string | null
    scheme: 'http' | 'https'
  }
  routes: {
    project: string | null
    service: string | null
    containerId: string
    containerName: string
    state: ContainerState
    urls: RouteUrl[]
    port: string
  }[]
  networks: NetworkSummary[]
  tailscale: {
    enabled: boolean
    running: boolean
    hostname: string
    state: ContainerState | 'absent'
    health: Health
  }
  dns: {
    provider: string
    cloudflareEnabled: boolean
    zone: string | null
  }
  tls: {
    enabled: boolean
    mode: string
    acmeEmailSet: boolean
    caServer: string
  }
}

export interface ConfigField {
  key: string
  /** Never populated for a secret: the panel reports only whether it is set. */
  value: string | null
  runtimeValue: string | null
  secret: boolean
  isSet: boolean
  /** The saved value differs from what the running gateway was started with. */
  pending: boolean
  kind: 'boolean' | 'string' | 'number' | 'choice'
  choices?: string[]
  group: string
  label: string
  help: string
  restartRequired: boolean
}

export interface ConfigView {
  fields: ConfigField[]
  envFile: { path: string; exists: boolean; writable: boolean }
  pendingRestart: boolean
  /** What to run on the host to make saved changes take effect. */
  applyCommand: string
  groups: string[]
}

export interface ConfigPatchResult {
  ok: boolean
  saved: string[]
  pendingRestart: boolean
  applyCommand: string
  /** Present when the save also rewrote a generated Traefik file. */
  dynamic?: { file: string; written: boolean; reason: string }
  view: ConfigView
}

export interface LogsResponse {
  containerId: string
  name: string
  lines: { stream: 'stdout' | 'stderr'; timestamp: string | null; text: string }[]
  truncated: boolean
}

export interface ActionResult {
  ok: boolean
  action: string
  containerId: string
  message: string
}

export interface RemovalPreview {
  containerId: string
  name: string
  image: string
  ownership: Ownership
  state: ContainerState
  project: string | null
  mounts: MountSummary[]
  namedVolumes: string[]
  networks: string[]
  warnings: string[]
  allowed: boolean
}

export type LiveEventKind =
  | 'container'
  | 'network'
  | 'bridge'
  | 'health'
  | 'project'
  | 'config'
  | 'hello'

export interface LiveEvent {
  kind: LiveEventKind
  action: string
  id: string | null
  name: string | null
  project: string | null
  ownership: Ownership | null
  at: number
}

export interface ApiError {
  error: string
  detail?: string
  hint?: string
}
