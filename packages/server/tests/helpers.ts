// Fixtures for the API tests: a fake Docker host built from plain objects, so
// every test states exactly the situation it is about.

import type { Hono } from 'hono'
import { join } from 'node:path'
import { createApp } from '../src/api/index.ts'
import { loadConfig, type PanelConfig } from '../src/config.ts'
import { createSnapshotCache } from '../src/services/inventory.ts'
import { LiveHub } from '../src/services/events.ts'
import { createVerdictCache } from '../src/services/traefik.ts'
import type { Database } from '../src/db/index.ts'
import { fakeActivity, fakeSessions, fakeTasks } from './fake-work.ts'
import type { GitHubIntegration } from '../src/services/integrations/github/index.ts'
import type { DockerClient, LogLine } from '../src/services/docker/client.ts'
import type {
  DockerContainerInspect,
  DockerContainerListItem,
  DockerInfo,
  DockerNetwork,
  DockerVersion,
} from '../src/services/docker/types.ts'

export interface FakeContainer {
  id: string
  name: string
  image: string
  state?: string
  labels?: Record<string, string>
  networks?: string[]
  exposed?: number[]
  published?: { hostIp: string; hostPort: number; containerPort: number }[]
  health?: 'healthy' | 'unhealthy' | 'starting'
  mounts?: { Type: string; Name?: string; Source: string; Destination: string; RW: boolean }[]
  startedAt?: string
  // A one-shot container is described by how it ended, not by whether it runs.
  // Without these two a fixture cannot say "exited with 2 at 10:05".
  exitCode?: number
  finishedAt?: string
  /** Docker's restart policy name; `no` when unset, as Docker reports it. */
  restartPolicy?: string
  env?: string[]
}

export function container(spec: FakeContainer): {
  item: DockerContainerListItem
  inspect: DockerContainerInspect
} {
  const state = spec.state ?? 'running'
  const labels = spec.labels ?? {}
  const networks = Object.fromEntries((spec.networks ?? ['bridge']).map((name) => [name, {}]))
  const ports: Record<string, { HostIp?: string; HostPort?: string }[] | null> = {}
  for (const port of spec.exposed ?? []) ports[`${port}/tcp`] = null
  for (const binding of spec.published ?? []) {
    ports[`${binding.containerPort}/tcp`] = [
      { HostIp: binding.hostIp, HostPort: String(binding.hostPort) },
    ]
  }

  const item: DockerContainerListItem = {
    Id: spec.id,
    Names: [`/${spec.name}`],
    Image: spec.image,
    ImageID: `sha256:${spec.id}`,
    Command: 'run',
    Created: 1_700_000_000,
    State: state,
    Status: state === 'running' ? 'Up 3 hours' : 'Exited (0) 3 hours ago',
    Labels: labels,
    Ports: [],
    NetworkSettings: { Networks: networks },
    Mounts: spec.mounts ?? [],
  }

  const inspect: DockerContainerInspect = {
    Id: spec.id,
    Name: `/${spec.name}`,
    Created: '2026-01-01T00:00:00Z',
    RestartCount: 0,
    State: {
      Status: state,
      Running: state === 'running',
      ExitCode: spec.exitCode ?? (state === 'running' ? 0 : 1),
      StartedAt: spec.startedAt ?? '2026-01-01T00:00:00Z',
      FinishedAt: spec.finishedAt ?? '0001-01-01T00:00:00Z',
      ...(spec.health ? { Health: { Status: spec.health, FailingStreak: 0 } } : {}),
    },
    Config: {
      Image: spec.image,
      Labels: labels,
      ExposedPorts: Object.fromEntries(
        [...(spec.exposed ?? []), ...(spec.published ?? []).map((p) => p.containerPort)].map((p) => [
          `${p}/tcp`,
          {},
        ]),
      ),
      Tty: false,
      Env: spec.env ?? [],
    },
    HostConfig: { RestartPolicy: { Name: spec.restartPolicy ?? 'no' } },
    NetworkSettings: { Ports: ports, Networks: networks },
    Mounts: spec.mounts ?? [],
  }

  return { item, inspect }
}

export interface FakeDockerOptions {
  containers?: FakeContainer[]
  networks?: Partial<DockerNetwork>[]
  logs?: LogLine[]
  /** Per container: lines to return, or an Error the read should reject with. */
  logsByContainer?: Record<string, LogLine[] | Error>
  failInspect?: string[]
  fail?: Partial<Record<'start' | 'stop' | 'restart', string[]>>
}

export interface FakeDocker {
  client: DockerClient
  calls: { method: string; args: unknown[] }[]
  removed: string[]
  created: unknown[]
}

export function fakeDocker(options: FakeDockerOptions = {}): FakeDocker {
  const built = (options.containers ?? []).map(container)
  const calls: { method: string; args: unknown[] }[] = []
  const removed: string[] = []
  const created: unknown[] = []

  const record = (method: string, ...args: unknown[]) => calls.push({ method, args })

  const networks: DockerNetwork[] = (
    options.networks ?? [
      { Name: 'portta', Labels: { 'portta.managed': 'true' } },
      { Name: 'portta-control', Internal: true, Labels: { 'portta.managed': 'true' } },
    ]
  ).map((network, index) => ({
    Id: network.Id ?? `net${index}`,
    Name: network.Name ?? `net${index}`,
    Driver: network.Driver ?? 'bridge',
    Scope: network.Scope ?? 'local',
    Internal: network.Internal ?? false,
    Labels: network.Labels ?? {},
    Containers: network.Containers ?? {},
  }))

  const client = {
    async ping() {
      return true
    },
    async version(): Promise<DockerVersion> {
      return { Version: '29.4.0', ApiVersion: '1.51', Os: 'linux', Arch: 'arm64' }
    },
    async info(): Promise<DockerInfo> {
      const running = built.filter((entry) => entry.item.State === 'running').length
      return {
        Name: 'test-host',
        Containers: built.length,
        ContainersRunning: running,
        ContainersPaused: 0,
        ContainersStopped: built.length - running,
        Images: 12,
        NCPU: 8,
        MemTotal: 17_179_869_184,
        OperatingSystem: 'Test Linux',
        Architecture: 'aarch64',
        ServerVersion: '29.4.0',
      }
    },
    async listContainers() {
      record('listContainers')
      return built.map((entry) => entry.item)
    },
    async inspect(id: string) {
      if ((options.failInspect ?? []).includes(id)) throw new Error('no such container')
      const found = built.find((entry) => entry.item.Id === id)
      if (!found) throw new Error('no such container')
      return found.inspect
    },
    async listNetworks() {
      return networks
    },
    async inspectNetwork(id: string) {
      return networks.find((network) => network.Id === id) ?? networks[0]!
    },
    async start(id: string) {
      record('start', id)
      if ((options.fail?.start ?? []).includes(id)) throw new Error(`start failed: ${id}`)
    },
    async stop(id: string) {
      record('stop', id)
      if ((options.fail?.stop ?? []).includes(id)) throw new Error(`stop failed: ${id}`)
    },
    async restart(id: string) {
      record('restart', id)
      if ((options.fail?.restart ?? []).includes(id)) throw new Error(`restart failed: ${id}`)
    },
    async remove(id: string, force: boolean) {
      record('remove', id, force)
      removed.push(id)
    },
    async stats() {
      return {
        cpu_stats: { cpu_usage: { total_usage: 200 }, system_cpu_usage: 2000, online_cpus: 4 },
        precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 1000 },
        memory_stats: { usage: 1024 * 1024 * 64, limit: 1024 * 1024 * 512, stats: {} },
      }
    },
    async logs(id: string, logOptions?: { tail?: number }) {
      record('logs', id, logOptions)
      const specific = options.logsByContainer?.[id]
      if (specific instanceof Error) throw specific
      if (specific) return specific
      return (
        options.logs ?? [
          { stream: 'stdout' as const, timestamp: '2026-01-01T00:00:01Z', text: 'hello' },
          { stream: 'stderr' as const, timestamp: '2026-01-01T00:00:02Z', text: 'boom' },
        ]
      )
    },
    async createBridge(spec: unknown) {
      record('createBridge', spec)
      created.push(spec)
      return 'bridge-container-id'
    },
    async *events() {
      // The tests drive the hub directly.
    },
  } as unknown as DockerClient

  return { client, calls, removed, created }
}

export function testConfig(overrides: Partial<PanelConfig> = {}): PanelConfig {
  const dynamicDir = overrides.dynamicDir ?? '/tmp/portta-test-dynamic'
  return loadConfig({
    dockerApi: 'http://socket-proxy:2375',
    envFile: '/dev/null',
    versionFile: '/dev/null',
    profile: 'local',
    domain: 'localhost',
    network: 'portta',
    controlNetwork: 'portta-control',
    accessNetwork: 'portta-access',
    gatewayVersion: '0.2.0',
    panelVersion: '0.1.0',
    tlsEnabled: false,
    readOnly: false,
    docs: true,
    docsDir: './dist/docs',
    privateDomain: null,
    publicDomain: null,
    dynamicDir,
    authStore: overrides.authStore ?? join(dynamicDir, 'protections.json'),
    runnerDir: overrides.runnerDir ?? join(dynamicDir, 'runner'),
    accessDir: overrides.accessDir ?? join(dynamicDir, 'access'),
    ...overrides,
  })
}

/**
 * Enough of `Database` to exercise the override endpoints without PostgreSQL.
 *
 * The point of these tests is the refusal and rollback logic, not the SQL, so
 * the store is a map and `available` is a flag the test can turn off to prove
 * the 503 path.
 */
export function fakeDatabase(options: { available?: boolean } = {}): Database & {
  projectValues: Map<string, unknown>
  serviceValues: Map<string, unknown>
  failWrites?: boolean
} {
  const projectValues = new Map<string, unknown>()
  const serviceValues = new Map<string, unknown>()
  const available = options.available ?? true
  const record = {
    id: 'e1', composeProject: 'alpha', workingDir: null, configFiles: [], repoUrl: null, repoSubpath: null,
    firstSeenAt: new Date(0), lastSeenAt: new Date(0), updatedAt: new Date(0),
  }

  const database = {
    projectValues,
    serviceValues,
    status: () => ({ configured: true, available, reason: available ? null : 'connection refused', checkedAt: 0, migrations: [] }),
    environments: {
      find: async (composeProject: string) => ({ ...record, composeProject }),
      upsertSeen: async () => record,
      list: async () => [record],
      recordCounts: async () => ({ overrides: 0, projectLinks: 0, issueLinks: 0 }),
      forget: async () => ({ overrides: 0, projectLinks: 0, issueLinks: 0 }),
    },
    projects: {
      find: async () => null,
      list: async () => [],
      listEnvironments: async () => [],
    },
    repositories: {
      list: async () => [],
      find: async () => null,
      findByGitHub: async () => null,
    },
    // Empty by default: an override test is not a GitHub test, and every join
    // must degrade to nothing rather than throw.
    github: {
      listIssues: async () => [],
      listRelationships: async () => [],
      findRepository: async () => null,
      findIssue: async () => null,
      findIssueByNumber: async () => null,
      listRepositories: async () => [],
    },
    tasks: fakeTasks(),
    sessions: fakeSessions(),
    activity: fakeActivity(),
    settings: {
      getGlobal: async () => null,
      getEnvironment: async (_id: string, key: string) => projectValues.get(key) ?? null,
      setEnvironment: async (_id: string, key: string, value: unknown) => void projectValues.set(key, value),
      clearEnvironment: async (_id: string, key: string) => void projectValues.delete(key),
      getService: async (_id: string, service: string, key: string) => serviceValues.get(`${service}:${key}`) ?? null,
      setService: async (_id: string, service: string, key: string, value: unknown) =>
        void serviceValues.set(`${service}:${key}`, value),
      clearService: async (_id: string, service: string, key: string) =>
        void serviceValues.delete(`${service}:${key}`),
      listAllEnvironment: async () =>
        [...projectValues].map(([key, value]) => ({ composeProject: 'alpha', key, value })),
      listAllService: async () =>
        [...serviceValues].map(([composite, value]) => {
          const [service, key] = composite.split(':')
          return { composeProject: 'alpha', service: service!, key: key!, value }
        }),
    },
  }
  return database as unknown as Database & {
    projectValues: Map<string, unknown>
    serviceValues: Map<string, unknown>
  }
}

export function makeApp(
  options: FakeDockerOptions = {},
  configOverrides: Partial<PanelConfig> = {},
  db: Database | null = null,
  github: GitHubIntegration | null = null,
) {
  const docker = fakeDocker(options)
  const config = testConfig(configOverrides)
  const cache = createSnapshotCache(docker.client, config, 0)
  const hub = new LiveHub(docker.client, cache)
  const verdict = createVerdictCache(config, 0)
  const app: Hono = createApp({ config, client: docker.client, cache, hub, verdict, db, github })
  return { app, docker, config, cache, hub, verdict, db, github }
}

/** Same-origin by default: the API refuses cross-origin writes. */
export async function post(app: Hono, path: string, body: unknown = {}, headers: Record<string, string> = {}): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost', ...headers },
  })
}

export async function del(app: Hono, path: string, body: unknown = {}): Promise<Response> {
  return app.request(path, {
    method: 'DELETE',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
  })
}
