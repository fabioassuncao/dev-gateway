// Fixtures for the API tests: a fake Docker host built from plain objects, so
// every test states exactly the situation it is about.

import type { Hono } from 'hono'
import { createApp } from '../../src/server/app.ts'
import { loadConfig, type PanelConfig } from '../../src/server/config.ts'
import { createSnapshotCache } from '../../src/server/core/inventory.ts'
import { LiveHub } from '../../src/server/core/events.ts'
import { createVerdictCache } from '../../src/server/core/traefik.ts'
import type { DockerClient, LogLine } from '../../src/server/docker/client.ts'
import type {
  DockerContainerInspect,
  DockerContainerListItem,
  DockerInfo,
  DockerNetwork,
  DockerVersion,
} from '../../src/server/docker/types.ts'

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
      ExitCode: state === 'running' ? 0 : 1,
      StartedAt: spec.startedAt ?? '2026-01-01T00:00:00Z',
      FinishedAt: '0001-01-01T00:00:00Z',
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
    },
    NetworkSettings: { Ports: ports, Networks: networks },
    Mounts: spec.mounts ?? [],
  }

  return { item, inspect }
}

export interface FakeDockerOptions {
  containers?: FakeContainer[]
  networks?: Partial<DockerNetwork>[]
  logs?: LogLine[]
  failInspect?: string[]
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
      { Name: 'dev-gateway', Labels: { 'dev-gateway.managed': 'true' } },
      { Name: 'dev-gateway-control', Internal: true, Labels: { 'dev-gateway.managed': 'true' } },
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
    },
    async stop(id: string) {
      record('stop', id)
    },
    async restart(id: string) {
      record('restart', id)
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
    async logs() {
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
  return loadConfig({
    dockerApi: 'http://socket-proxy:2375',
    envFile: '/dev/null',
    versionFile: '/dev/null',
    profile: 'local',
    domain: 'localhost',
    network: 'dev-gateway',
    controlNetwork: 'dev-gateway-control',
    accessNetwork: 'dev-gateway-access',
    gatewayVersion: '0.1.1',
    panelVersion: '0.1.0',
    tlsEnabled: false,
    readOnly: false,
    privateDomain: null,
    publicDomain: null,
    ...overrides,
  })
}

export function makeApp(options: FakeDockerOptions = {}, configOverrides: Partial<PanelConfig> = {}) {
  const docker = fakeDocker(options)
  const config = testConfig(configOverrides)
  const cache = createSnapshotCache(docker.client, config, 0)
  const hub = new LiveHub(docker.client, cache)
  const verdict = createVerdictCache(config, 0)
  const app: Hono = createApp({ config, client: docker.client, cache, hub, verdict, db: null })
  return { app, docker, config, cache, hub, verdict }
}

/** Same-origin by default: the API refuses cross-origin writes. */
export async function post(app: Hono, path: string, body: unknown = {}): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
  })
}

export async function del(app: Hono, path: string, body: unknown = {}): Promise<Response> {
  return app.request(path, {
    method: 'DELETE',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
  })
}
