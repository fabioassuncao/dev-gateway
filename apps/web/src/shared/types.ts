// The contract between the API and the UI. Zod is the single source of truth:
// every exported type is inferred from the schema that also documents the API.
// Responses are validated in tests, not on the production hot path.

import { z } from 'zod'

const named = <T extends z.ZodType>(schema: T, ref: string): T => schema.meta({ ref }) as T
const unixSeconds = z.number().describe('Unix timestamp in seconds')

export const Ownership = named(
  z.enum(['gateway', 'integrated', 'external', 'standalone']).describe('How the gateway classifies a container'),
  'Ownership',
)
export type Ownership = z.infer<typeof Ownership>

export const ServiceTech = named(
  z.object({
    id: z.string().describe('Stable key used to pick an icon, for example postgres, nginx or docker'),
    label: z.string().describe('Short human label shown next to the icon'),
  }).strict(),
  'ServiceTech',
)
export type ServiceTech = z.infer<typeof ServiceTech>

export const ContainerState = named(
  z.enum(['created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead']),
  'ContainerState',
)
export type ContainerState = z.infer<typeof ContainerState>

export const Health = named(z.enum(['healthy', 'unhealthy', 'starting', 'none']), 'Health')
export type Health = z.infer<typeof Health>

export const UrlScope = named(
  z.enum(['local', 'vpn', 'public']).describe('Where a routed URL can be reached from'),
  'UrlScope',
)
export type UrlScope = z.infer<typeof UrlScope>

export const TcpRouting = named(
  z.enum(['starttls-sni', 'tls-sni', 'unsupported', 'unevaluated'])
    .describe('Whether a TCP protocol can be told apart by hostname on a shared port'),
  'TcpRouting',
)
export type TcpRouting = z.infer<typeof TcpRouting>

export const ServiceKind = named(
  z.enum(['http', 'postgres', 'mysql', 'redis', 'mongodb', 'memcached', 'search', 'amqp', 'clickhouse', 'smtp', 'tcp']),
  'ServiceKind',
)
export type ServiceKind = z.infer<typeof ServiceKind>

export const PublishedPort = named(
  z.object({
    ip: z.string(),
    hostPort: z.number().int(),
    containerPort: z.number().int(),
    protocol: z.string(),
  }).strict(),
  'PublishedPort',
)
export type PublishedPort = z.infer<typeof PublishedPort>

export const RouteUrl = named(
  z.object({
    url: z.string().describe('Absolute URL served by Traefik'),
    host: z.string(),
    scope: UrlScope,
    scheme: z.enum(['http', 'https']),
  }).strict(),
  'RouteUrl',
)
export type RouteUrl = z.infer<typeof RouteUrl>

export const MountSummary = named(
  z.object({
    type: z.string(),
    name: z.string().nullable(),
    source: z.string(),
    destination: z.string(),
    rw: z.boolean(),
  }).strict(),
  'MountSummary',
)
export type MountSummary = z.infer<typeof MountSummary>

/**
 * What the gateway decided about a project, as opposed to what the project
 * declared. Always additive: the derived name and hostname stay where they
 * were, so nothing is ever only-renamed.
 */
export const ProjectOverrides = named(
  z.object({
    displayName: z.string().optional(),
    description: z.string().optional(),
    color: z.string().optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
    primaryService: z.string().optional(),
    hiddenServices: z.array(z.string()).optional(),
    serviceOrder: z.array(z.string()).optional(),
  }).strict(),
  'ProjectOverrides',
)
export type ProjectOverrides = z.infer<typeof ProjectOverrides>

export const ServiceOverrides = named(
  z.object({
    alias: z.string().optional().describe('An additional hostname, routed by Traefik'),
    note: z.string().optional(),
    hidden: z.boolean().optional(),
  }).strict(),
  'ServiceOverrides',
)
export type ServiceOverrides = z.infer<typeof ServiceOverrides>

export const ContainerSummary = named(
  z.object({
    id: z.string().describe('Docker container id'),
    name: z.string(),
    image: z.string(),
    state: ContainerState,
    status: z.string(),
    health: Health,
    createdAt: unixSeconds,
    startedAt: unixSeconds.nullable(),
    uptimeSeconds: z.number().nullable(),
    ownership: Ownership,
    gatewayComponent: z.string().nullable(),
    project: z.string().nullable().describe('Compose project name'),
    service: z.string().nullable().describe('Compose service name'),
    workingDir: z.string().nullable(),
    namespace: z.string().nullable(),
    group: z.string().nullable().describe('Optional dev-gateway.project logical project label'),
    repo: z.string().nullable().describe('Optional dev-gateway.repo label as supplied by the project'),
    repoUrl: z.string().nullable().describe('Repository web address derived from repo'),
    gitRoot: z.string().nullable().describe('Optional dev-gateway.git.root label'),
    networks: z.array(z.string()),
    onGatewayNetwork: z.boolean(),
    traefikEnabled: z.boolean(),
    ports: z.array(PublishedPort),
    exposedPorts: z.array(z.number().int()),
    kind: ServiceKind,
    tech: ServiceTech,
    urls: z.array(RouteUrl),
    mounts: z.array(MountSummary),
    labels: z.record(z.string(), z.string()),
    restartCount: z.number().int(),
    exitCode: z.number().int().nullable(),
    overrides: ServiceOverrides.optional().describe('Absent when nothing was overridden'),
  }).strict(),
  'ContainerSummary',
)
export type ContainerSummary = z.infer<typeof ContainerSummary>

export const Project = named(
  z.object({
    name: z.string().describe('COMPOSE_PROJECT_NAME; the key used by project endpoints'),
    integrated: z.boolean(),
    workingDir: z.string().nullable(),
    namespace: z.string().nullable(),
    group: z.string().nullable(),
    repo: z.string().nullable(),
    repoUrl: z.string().nullable(),
    gitRoot: z.string().nullable(),
    services: z.array(ContainerSummary),
    serviceCount: z.number().int(),
    runningCount: z.number().int(),
    healthyCount: z.number().int(),
    unhealthyCount: z.number().int(),
    networks: z.array(z.string()),
    urls: z.array(RouteUrl),
    scopes: z.array(UrlScope),
    startedAt: unixSeconds.nullable(),
    uptimeSeconds: z.number().nullable(),
    overrides: ProjectOverrides.optional().describe('Absent when nothing was overridden'),
  }).strict(),
  'Project',
)
export type Project = z.infer<typeof Project>

export const GitHead = named(
  z.object({
    sha: z.string(),
    shortSha: z.string(),
    subject: z.string(),
    author: z.string(),
    date: unixSeconds,
  }).strict(),
  'GitHead',
)
export type GitHead = z.infer<typeof GitHead>

export const GitInfo = named(
  z.object({
    branch: z.string().nullable().describe('Null on a detached HEAD'),
    detached: z.boolean(),
    head: GitHead,
    staged: z.number().int(),
    unstaged: z.number().int(),
    untracked: z.number().int(),
    unmerged: z.number().int(),
    dirty: z.boolean(),
    upstream: z.string().nullable(),
    ahead: z.number().int(),
    behind: z.number().int(),
    remote: z.string().nullable().describe('Remote as Git reports it, or the dev-gateway.repo label'),
  }).strict(),
  'GitInfo',
)
export type GitInfo = z.infer<typeof GitInfo>

export const ForgePullRequest = named(
  z.object({
    number: z.number().int(),
    title: z.string(),
    state: z.string(),
    draft: z.boolean(),
    reviewDecision: z.string().nullable(),
    checks: z.string().nullable(),
    url: z.string().nullable(),
    headRefName: z.string().nullable(),
  }).strict(),
  'ForgePullRequest',
)
export type ForgePullRequest = z.infer<typeof ForgePullRequest>

export const Forge = named(
  z.object({
    kind: z.string(),
    collectedAt: unixSeconds,
    authenticated: z.boolean().describe('False when gh was present but not signed in'),
    reason: z.string().nullable(),
    pulls: z.array(ForgePullRequest),
  }).strict(),
  'Forge',
)
export type Forge = z.infer<typeof Forge>

const ProjectRemote = z.object({
  url: z.string(),
  host: z.string(),
  slug: z.string(),
  kind: z.string(),
  repoUrl: z.string(),
}).strict()

const ProjectGitLinks = z.object({
  repo: z.string().nullable(),
  commit: z.string().nullable(),
  branch: z.string().nullable(),
}).strict()

export const ProjectGit = named(
  z.object({
    project: z.string(),
    collected: z.boolean().describe('False when no scan file exists'),
    collectedAt: unixSeconds.nullable(),
    ageSeconds: z.number().nullable(),
    stale: z.boolean(),
    staleAfterSeconds: z.number(),
    workingDir: z.string().nullable(),
    git: GitInfo.nullable(),
    remote: ProjectRemote.nullable(),
    links: ProjectGitLinks,
    forge: Forge.nullable(),
    reason: z.string().nullable().describe('Why Git metadata is absent, when known'),
    refreshCommand: z.string().describe('Exact host command that refreshes this snapshot'),
  }).strict().describe('Metadata collected by dev-gateway git scan for one project'),
  'ProjectGit',
)
export type ProjectGit = z.infer<typeof ProjectGit>

export const TraefikRouter = named(
  z.object({
    name: z.string(),
    rule: z.string(),
    hosts: z.array(z.string()).describe('Every Host rule name, lowercased'),
    entryPoints: z.array(z.string()),
    middlewares: z.array(z.string()),
    service: z.string(),
    provider: z.string(),
    status: z.string().describe('Traefik verdict: enabled, disabled or warning'),
    errors: z.array(z.string()).describe('Traefik error text when it rejected the router'),
    servers: z.array(z.string()).describe('Backends Traefik resolved for this router'),
  }).strict(),
  'TraefikRouter',
)
export type TraefikRouter = z.infer<typeof TraefikRouter>

export const TraefikVerdict = named(
  z.object({
    available: z.boolean().describe('False when the API is off or unreachable'),
    reason: z.string().nullable(),
    baseUrl: z.string(),
    dashboardUrl: z.string().nullable(),
    routers: z.array(TraefikRouter),
    fetchedAt: unixSeconds,
  }).strict(),
  'TraefikVerdict',
)
export type TraefikVerdict = z.infer<typeof TraefikVerdict>

export const ServiceTraefik = named(
  z.object({
    containerId: z.string(),
    available: z.boolean(),
    reason: z.string().nullable(),
    expectedHosts: z.array(z.string()).describe('Hostnames derived from labels, for comparison'),
    routers: z.array(TraefikRouter.extend({ dashboardUrl: z.string().nullable() }).strict()),
    fetchedAt: unixSeconds,
  }).strict(),
  'ServiceTraefik',
)
export type ServiceTraefik = z.infer<typeof ServiceTraefik>

export const ShareMode = named(z.enum(['public', 'protected']), 'ShareMode')
export type ShareMode = z.infer<typeof ShareMode>

export const ShareState = named(z.enum(['active', 'expired', 'dangling']), 'ShareState')
export type ShareState = z.infer<typeof ShareState>

export const Share = named(
  z.object({
    id: z.string(),
    project: z.string(),
    service: z.string(),
    container: z.string().describe('Unique container name used as the Traefik backend'),
    port: z.number().int(),
    host: z.string(),
    url: z.string(),
    mode: ShareMode,
    user: z.string().nullable().describe('Username for a protected share; never a password'),
    createdAt: unixSeconds,
    expiresAt: unixSeconds,
    expiresInSeconds: z.number(),
    state: ShareState,
  }).strict(),
  'Share',
)
export type Share = z.infer<typeof Share>

export const ShareView = named(
  z.object({
    shares: z.array(Share),
    domain: z.string().describe('Domain reserved for temporary share hostnames'),
    publicAllowed: z.boolean().describe('Whether a public share would be accepted'),
    maxTtlSeconds: z.number().int(),
  }).strict(),
  'ShareView',
)
export type ShareView = z.infer<typeof ShareView>

export const Diagnostic = named(
  z.object({
    id: z.string(),
    status: z.enum(['pass', 'warn', 'fail']),
    title: z.string(),
    detail: z.string(),
    fix: z.string(),
  }).strict(),
  'Diagnostic',
)
export type Diagnostic = z.infer<typeof Diagnostic>

const GatewayTls = z.object({ enabled: z.boolean(), mode: z.string() }).strict()
const GatewayTailscale = z.object({ enabled: z.boolean(), running: z.boolean(), hostname: z.string() }).strict()
const GatewayPublicAccess = z.object({ enabled: z.boolean(), domain: z.string().nullable() }).strict()
const GatewayPanel = z.object({
  expose: z.string(),
  routed: z.boolean(),
  auth: z.string(),
  authenticated: z.boolean(),
  user: z.string(),
  readOnly: z.boolean(),
}).strict()
const GatewayDashboard = z.object({ enabled: z.boolean(), bindAddress: z.string(), port: z.string() }).strict()
const GatewayComponent = z.object({
  containerId: z.string().nullable(),
  state: ContainerState.or(z.literal('absent')),
  health: Health,
}).strict()
const GatewaySocketProxy = z.object({
  containerId: z.string().nullable(),
  state: ContainerState.or(z.literal('absent')),
}).strict()
const GatewayNetwork = z.object({
  name: z.string(),
  exists: z.boolean(),
  attached: z.number().int(),
  internal: z.boolean(),
}).strict()

export const GatewayStatus = named(
  z.object({
    gatewayVersion: z.string(),
    panelVersion: z.string(),
    profile: z.string(),
    domain: z.string(),
    privateDomain: z.string().nullable(),
    publicDomain: z.string().nullable(),
    bindAddress: z.string(),
    httpPort: z.string(),
    httpsPort: z.string(),
    scheme: z.enum(['http', 'https']),
    up: z.boolean(),
    reachable: z.boolean(),
    tls: GatewayTls,
    tailscale: GatewayTailscale,
    publicAccess: GatewayPublicAccess,
    panel: GatewayPanel.describe('Panel exposure and authentication without the secret hash'),
    dashboard: GatewayDashboard,
    traefik: GatewayComponent,
    socketProxy: GatewaySocketProxy,
    database: GatewayComponent,
    network: GatewayNetwork,
    routes: z.number().int(),
  }).strict(),
  'GatewayStatus',
)
export type GatewayStatus = z.infer<typeof GatewayStatus>

export const OverviewCounts = named(
  z.object({
    projects: z.number().int(),
    integratedProjects: z.number().int(),
    services: z.number().int(),
    servicesRunning: z.number().int(),
    servicesHealthy: z.number().int(),
    servicesUnhealthy: z.number().int(),
    containersTotal: z.number().int(),
    containersRunning: z.number().int(),
    containersGateway: z.number().int(),
    containersIntegrated: z.number().int(),
    containersExternal: z.number().int(),
    containersStandalone: z.number().int(),
    bridges: z.number().int(),
    forwarders: z.number().int(),
    routes: z.number().int(),
    shares: z.number().int(),
    sharesStale: z.number().int().describe('Shares that expired or whose target is gone'),
  }).strict(),
  'OverviewCounts',
)
export type OverviewCounts = z.infer<typeof OverviewCounts>

export const RateLimit = named(
  z.object({
    limit: z.number().int().nullable(),
    remaining: z.number().int().nullable(),
    resetAt: unixSeconds.nullable(),
    readAt: unixSeconds.nullable(),
  }).strict(),
  'RateLimit',
)
export type RateLimit = z.infer<typeof RateLimit>

/** Never a token, a key or a webhook secret: only whether it works, and how old. */
export const GitHubStatus = named(
  z.object({
    configured: z.boolean().describe('False when GITHUB_APP_ENABLED is off'),
    available: z.boolean(),
    reason: z.string().nullable(),
    checkedAt: unixSeconds.nullable(),
    appId: z.string().nullable(),
    apiUrl: z.string(),
    rateLimit: RateLimit,
  }).strict(),
  'GitHubStatus',
)
export type GitHubStatus = z.infer<typeof GitHubStatus>

export const GitHubInstallation = named(
  z.object({
    installationId: z.number().int(),
    accountLogin: z.string(),
    accountType: z.string(),
    suspended: z.boolean(),
    permissions: z.record(z.string(), z.string()),
    syncedAt: unixSeconds,
  }).strict(),
  'GitHubInstallation',
)
export type GitHubInstallation = z.infer<typeof GitHubInstallation>

export const GitHubRepositoryView = named(
  z.object({
    githubId: z.number().int(),
    installationId: z.number().int(),
    owner: z.string(),
    name: z.string(),
    fullName: z.string(),
    defaultBranch: z.string().nullable(),
    private: z.boolean(),
    htmlUrl: z.string(),
    archived: z.boolean(),
    syncedAt: unixSeconds,
  }).strict(),
  'GitHubRepositoryView',
)
export type GitHubRepositoryView = z.infer<typeof GitHubRepositoryView>

export const GitHubSyncScope = named(
  z.object({
    scope: z.string(),
    lastSyncedAt: unixSeconds.nullable(),
    lastError: z.string().nullable(),
  }).strict(),
  'GitHubSyncScope',
)
export type GitHubSyncScope = z.infer<typeof GitHubSyncScope>

export const GitHubIntegrationView = named(
  z.object({
    status: GitHubStatus,
    installations: z.array(GitHubInstallation),
    repositoryCount: z.number().int(),
    sync: z.array(GitHubSyncScope),
    /** True when the projection cannot be read, not when GitHub is down. */
    projectionAvailable: z.boolean(),
  }).strict(),
  'GitHubIntegrationView',
)
export type GitHubIntegrationView = z.infer<typeof GitHubIntegrationView>

export const Overview = named(
  z.object({
    gateway: GatewayStatus,
    counts: OverviewCounts,
    urls: z.array(RouteUrl),
    problems: z.array(Diagnostic),
    generatedAt: unixSeconds,
    github: GitHubStatus.optional().describe('Absent on a panel built before the integration existed'),
  }).strict(),
  'Overview',
)
export type Overview = z.infer<typeof Overview>

export const NetworkSummary = named(
  z.object({
    id: z.string(),
    name: z.string(),
    driver: z.string(),
    scope: z.string(),
    internal: z.boolean(),
    containerCount: z.number().int(),
    managed: z.boolean(),
    role: z.enum(['shared', 'control', 'access', 'project', 'other']),
  }).strict(),
  'NetworkSummary',
)
export type NetworkSummary = z.infer<typeof NetworkSummary>

const PortBinding = z.object({
  ip: z.string(),
  containerId: z.string(),
  containerName: z.string(),
  ownership: Ownership,
  containerPort: z.number().int(),
}).strict()

export const PortUsage = named(
  z.object({
    hostPort: z.number().int(),
    protocol: z.string(),
    bindings: z.array(PortBinding),
    conflict: z.boolean(),
  }).strict(),
  'PortUsage',
)
export type PortUsage = z.infer<typeof PortUsage>

export const DockerHost = named(
  z.object({
    engine: z.object({
      version: z.string(),
      apiVersion: z.string(),
      os: z.string(),
      arch: z.string(),
      cpus: z.number().int(),
      memoryBytes: z.number(),
      name: z.string(),
    }).strict(),
    containers: z.object({
      total: z.number().int(),
      running: z.number().int(),
      paused: z.number().int(),
      stopped: z.number().int(),
    }).strict(),
    byOwnership: z.object({
      gateway: z.number().int(),
      integrated: z.number().int(),
      external: z.number().int(),
      standalone: z.number().int(),
    }).strict(),
    networks: z.array(NetworkSummary),
    ports: z.array(PortUsage),
  }).strict(),
  'DockerHost',
)
export type DockerHost = z.infer<typeof DockerHost>

export const Bridge = named(
  z.object({
    id: z.string(),
    containerId: z.string(),
    project: z.string(),
    service: z.string(),
    targetPort: z.number().int(),
    localPort: z.number().int().nullable(),
    bindIp: z.string(),
    kind: ServiceKind,
    network: z.string(),
    createdAt: unixSeconds.nullable(),
    expiresAt: unixSeconds.nullable(),
    state: ContainerState.or(z.literal('absent')),
    connectionString: z.string(),
  }).strict(),
  'Bridge',
)
export type Bridge = z.infer<typeof Bridge>

export const Forwarder = named(
  z.object({
    alias: z.string(),
    containerId: z.string(),
    project: z.string(),
    service: z.string(),
    port: z.number().int(),
    kind: ServiceKind,
    state: ContainerState.or(z.literal('absent')),
    networks: z.array(z.string()),
  }).strict(),
  'Forwarder',
)
export type Forwarder = z.infer<typeof Forwarder>

export const TcpService = named(
  z.object({
    containerId: z.string(),
    project: z.string(),
    service: z.string(),
    image: z.string(),
    kind: ServiceKind,
    tech: ServiceTech,
    state: ContainerState,
    health: Health,
    ports: z.array(z.number().int()),
    defaultPort: z.number().int().nullable(),
    publishedPorts: z.array(PublishedPort),
    privateNetworks: z.array(z.string()),
    bridge: Bridge.nullable(),
    forwarder: Forwarder.nullable(),
    integrated: z.boolean(),
    routing: TcpRouting.describe('How this protocol can be routed by hostname'),
    routed: z.boolean().describe('Whether the container opted into a TCP router'),
    gatewayAddress: z.string().nullable(),
    gatewayConnectionString: z.string().nullable(),
  }).strict(),
  'TcpService',
)
export type TcpService = z.infer<typeof TcpService>

export const AccessView = named(
  z.object({
    services: z.array(TcpService),
    bridges: z.array(Bridge),
    forwarders: z.array(Forwarder),
    bridgeImageHint: z.string(),
    tcpRoutingEnabled: z.boolean().describe('Whether TCP entrypoints are currently published'),
  }).strict(),
  'AccessView',
)
export type AccessView = z.infer<typeof AccessView>

const NetworkRoute = z.object({
  project: z.string().nullable(),
  service: z.string().nullable(),
  containerId: z.string(),
  containerName: z.string(),
  state: ContainerState,
  urls: z.array(RouteUrl),
  port: z.string(),
}).strict()

export const NetworkView = named(
  z.object({
    gateway: GatewayStatus,
    domains: z.object({
      local: z.string(),
      private: z.string().nullable(),
      public: z.string().nullable(),
      scheme: z.enum(['http', 'https']),
    }).strict(),
    routes: z.array(NetworkRoute),
    networks: z.array(NetworkSummary),
    tailscale: z.object({
      enabled: z.boolean(),
      running: z.boolean(),
      hostname: z.string(),
      state: ContainerState.or(z.literal('absent')),
      health: Health,
    }).strict(),
    dns: z.object({
      provider: z.string(),
      cloudflareEnabled: z.boolean(),
      zone: z.string().nullable(),
    }).strict(),
    tls: z.object({
      enabled: z.boolean(),
      mode: z.string(),
      acmeEmailSet: z.boolean(),
      caServer: z.string(),
    }).strict(),
  }).strict(),
  'NetworkView',
)
export type NetworkView = z.infer<typeof NetworkView>

export const ConfigField = named(
  z.object({
    key: z.string(),
    value: z.string().nullable().describe('Never populated for a secret'),
    runtimeValue: z.string().nullable(),
    secret: z.boolean(),
    isSet: z.boolean(),
    pending: z.boolean().describe('Saved value differs from the running process'),
    kind: z.enum(['boolean', 'string', 'number', 'choice']),
    choices: z.array(z.string()).optional(),
    group: z.string(),
    label: z.string(),
    help: z.string(),
    restartRequired: z.boolean(),
  }).strict(),
  'ConfigField',
)
export type ConfigField = z.infer<typeof ConfigField>

export const ConfigView = named(
  z.object({
    fields: z.array(ConfigField),
    envFile: z.object({ path: z.string(), exists: z.boolean(), writable: z.boolean() }).strict(),
    pendingRestart: z.boolean(),
    applyCommand: z.string().describe('Host command that applies saved changes'),
    groups: z.array(z.string()),
  }).strict(),
  'ConfigView',
)
export type ConfigView = z.infer<typeof ConfigView>

export const ConfigPatchResult = named(
  z.object({
    ok: z.boolean(),
    saved: z.array(z.string()),
    pendingRestart: z.boolean(),
    applyCommand: z.string(),
    dynamic: z.object({
      file: z.string(),
      written: z.boolean(),
      reason: z.string(),
    }).strict().optional().describe('Present when saving also rewrote a generated Traefik file'),
    view: ConfigView,
  }).strict(),
  'ConfigPatchResult',
)
export type ConfigPatchResult = z.infer<typeof ConfigPatchResult>

const LogLine = z.object({
  stream: z.enum(['stdout', 'stderr']),
  timestamp: z.string().nullable(),
  text: z.string(),
}).strict()

export const LogsResponse = named(
  z.object({
    containerId: z.string(),
    name: z.string(),
    lines: z.array(LogLine),
    truncated: z.boolean(),
  }).strict(),
  'LogsResponse',
)
export type LogsResponse = z.infer<typeof LogsResponse>

/** One service of a project, and whether its output could be read. */
export const ProjectLogSource = named(
  z.object({
    containerId: z.string(),
    service: z.string().describe('Compose service name, or the container name when unlabelled'),
    name: z.string().describe('Container name'),
    state: ContainerState,
    lineCount: z.number().int(),
    truncated: z.boolean(),
    error: z.string().nullable().describe('Why this source contributed no lines'),
  }).strict(),
  'ProjectLogSource',
)
export type ProjectLogSource = z.infer<typeof ProjectLogSource>

export const ProjectLogLine = named(
  z.object({
    stream: z.enum(['stdout', 'stderr']),
    timestamp: z.string().nullable(),
    text: z.string(),
    service: z.string().describe('Which source produced this line'),
  }).strict(),
  'ProjectLogLine',
)
export type ProjectLogLine = z.infer<typeof ProjectLogLine>

export const ProjectLogsResponse = named(
  z.object({
    project: z.string(),
    sources: z.array(ProjectLogSource),
    lines: z.array(ProjectLogLine).describe('Merged and ordered by timestamp where one exists'),
    truncated: z.boolean(),
    ordered: z.boolean().describe('False when a source logged without timestamps, so ordering is approximate'),
  }).strict(),
  'ProjectLogsResponse',
)
export type ProjectLogsResponse = z.infer<typeof ProjectLogsResponse>

export const ActionResult = named(
  z.object({ ok: z.boolean(), action: z.string(), containerId: z.string(), message: z.string() }).strict(),
  'ActionResult',
)
export type ActionResult = z.infer<typeof ActionResult>

export const RemovalPreview = named(
  z.object({
    containerId: z.string(),
    name: z.string(),
    image: z.string(),
    ownership: Ownership,
    state: ContainerState,
    project: z.string().nullable(),
    mounts: z.array(MountSummary),
    namedVolumes: z.array(z.string()),
    networks: z.array(z.string()),
    warnings: z.array(z.string()),
    allowed: z.boolean(),
  }).strict(),
  'RemovalPreview',
)
export type RemovalPreview = z.infer<typeof RemovalPreview>

export const LiveEventKind = named(
  z.enum(['container', 'network', 'bridge', 'health', 'project', 'config', 'hello']),
  'LiveEventKind',
)
export type LiveEventKind = z.infer<typeof LiveEventKind>

export const LiveEvent = named(
  z.object({
    kind: LiveEventKind,
    action: z.string(),
    id: z.string().nullable(),
    name: z.string().nullable(),
    project: z.string().nullable(),
    ownership: Ownership.nullable(),
    at: unixSeconds,
  }).strict(),
  'LiveEvent',
)
export type LiveEvent = z.infer<typeof LiveEvent>

export const ApiError = named(
  z.object({
    error: z.string(),
    detail: z.string().optional(),
    hint: z.string().optional(),
  }).strict().describe('Uniform error envelope returned by the panel API'),
  'ApiError',
)
export type ApiError = z.infer<typeof ApiError>
