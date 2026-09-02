import type { ContainerSummary, DockerHost, ProjectOperable, ProjectStartable } from '../../src/shared/types.ts'

export function makeStartable(ok = false): ProjectStartable {
  return ok
    ? { ok: true, reason: null, via: 'iteration' }
    : { ok: false, reason: 'every service is already running', via: null }
}

export function makeOperable(workingDir: string | null = '/srv/dev/alpha'): ProjectOperable {
  if (!workingDir) {
    return {
      ok: false,
      reason: 'this project has no Compose working directory label, so the runner cannot find it',
      workingDir: null,
      configFiles: [],
    }
  }
  return { ok: true, reason: null, workingDir, configFiles: [] }
}
import { resolveServiceTech } from '../../src/server/core/tech.ts'

export function makeContainer(overrides: Partial<ContainerSummary> = {}): ContainerSummary {
  const image = overrides.image ?? 'nginx:1.31.4-alpine'
  const service = overrides.service ?? null
  const base: ContainerSummary = {
    id: 'c1',
    name: 'container-1',
    image,
    state: 'running',
    status: 'Up 3 hours',
    health: 'none',
    createdAt: 1_700_000_000,
    startedAt: 1_700_000_000,
    uptimeSeconds: 3600,
    ownership: 'external',
    gatewayComponent: null,
    environment: null,
    service,
    workingDir: null,
    namespace: null,
    group: null,
    repo: null,
    repoUrl: null,
    gitRoot: null,
    networks: ['bridge'],
    onGatewayNetwork: false,
    traefikEnabled: false,
    ports: [],
    exposedPorts: [],
    kind: 'tcp',
    tech: resolveServiceTech({ image, service }),
    urls: [],
    mounts: [],
    labels: {},
    restartCount: 0,
    exitCode: null,
  }
  return { ...base, ...overrides, tech: overrides.tech ?? resolveServiceTech({
    image: overrides.image ?? base.image,
    service: overrides.service ?? base.service,
    labels: overrides.labels ?? base.labels,
  }) }
}

export const CONTAINERS: ContainerSummary[] = [
  makeContainer({
    id: 'gw-traefik',
    name: 'portta-traefik-1',
    image: 'traefik:v3.7.12',
    ownership: 'gateway',
    gatewayComponent: 'traefik',
    health: 'healthy',
    networks: ['portta', 'portta-control'],
  }),
  makeContainer({
    id: 'a-web',
    name: 'alpha-web-1',
    ownership: 'integrated',
    environment: 'alpha',
    service: 'web',
    traefikEnabled: true,
    onGatewayNetwork: true,
    kind: 'http',
    health: 'healthy',
    networks: ['portta', 'alpha_default'],
    urls: [
      { url: 'http://alpha-web.localhost', host: 'alpha-web.localhost', scope: 'local', scheme: 'http' },
    ],
  }),
  makeContainer({
    id: 'ext-pg',
    name: 'legacy-postgres',
    image: 'postgres:18.6-alpine',
    ownership: 'external',
    environment: 'legacy',
    service: 'postgres',
    kind: 'postgres',
    networks: ['legacy_default'],
    exposedPorts: [5432],
    ports: [{ ip: '0.0.0.0', hostPort: 5432, containerPort: 5432, protocol: 'tcp' }],
    mounts: [
      {
        type: 'volume',
        name: 'legacy_pgdata',
        source: '/var/lib/docker/volumes/legacy_pgdata',
        destination: '/var/lib/postgresql/data',
        rw: true,
      },
    ],
  }),
  makeContainer({
    id: 'solo-old',
    name: 'some-old-container',
    image: 'busybox:1.37.0',
    ownership: 'standalone',
    state: 'exited',
    uptimeSeconds: null,
  }),
]

export const HOST: DockerHost = {
  engine: {
    version: '29.4.0',
    apiVersion: '1.51',
    os: 'Test Linux',
    arch: 'aarch64',
    cpus: 8,
    memoryBytes: 17_179_869_184,
    name: 'test-host',
  },
  containers: { total: 4, running: 3, paused: 0, stopped: 1 },
  byOwnership: { gateway: 1, integrated: 1, external: 1, standalone: 1 },
  networks: [
    {
      id: 'n1',
      name: 'portta',
      driver: 'bridge',
      scope: 'local',
      internal: false,
      containerCount: 2,
      managed: true,
      role: 'shared',
    },
  ],
  ports: [
    {
      hostPort: 3000,
      protocol: 'tcp',
      conflict: true,
      bindings: [
        { ip: '127.0.0.1', containerId: 'x', containerName: 'one', ownership: 'external', containerPort: 3000 },
        { ip: '0.0.0.0', containerId: 'y', containerName: 'two', ownership: 'standalone', containerPort: 3000 },
      ],
    },
    {
      hostPort: 5432,
      protocol: 'tcp',
      conflict: false,
      bindings: [
        {
          ip: '0.0.0.0',
          containerId: 'ext-pg',
          containerName: 'legacy-postgres',
          ownership: 'external',
          containerPort: 5432,
        },
      ],
    },
  ],
}
