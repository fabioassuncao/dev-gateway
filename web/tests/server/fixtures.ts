// The host the tests describe: a gateway, two integrated projects, and a few
// containers that have nothing to do with any of it.

import type { FakeContainer } from './helpers.ts'

export const GATEWAY: FakeContainer[] = [
  {
    id: 'gw-traefik',
    name: 'dev-gateway-traefik-1',
    image: 'traefik:v3.7.12',
    health: 'healthy',
    networks: ['dev-gateway', 'dev-gateway-control'],
    labels: {
      'dev-gateway.managed': 'true',
      'dev-gateway.component': 'traefik',
      'traefik.enable': 'false',
    },
    published: [
      { hostIp: '127.0.0.1', hostPort: 80, containerPort: 80 },
      { hostIp: '127.0.0.1', hostPort: 443, containerPort: 443 },
    ],
  },
  {
    id: 'gw-proxy',
    name: 'dev-gateway-socket-proxy-1',
    image: 'tecnativa/docker-socket-proxy:v0.5.0',
    networks: ['dev-gateway-control'],
    labels: {
      'dev-gateway.managed': 'true',
      'dev-gateway.component': 'socket-proxy',
      'traefik.enable': 'false',
    },
  },
]

export const PROJECT_A: FakeContainer[] = [
  {
    id: 'a-web',
    name: 'alpha-web-1',
    image: 'nginx:1.31.4-alpine',
    health: 'healthy',
    networks: ['dev-gateway', 'alpha_default'],
    exposed: [80],
    labels: {
      'com.docker.compose.project': 'alpha',
      'com.docker.compose.service': 'web',
      'com.docker.compose.project.working_dir': '/srv/dev/alpha',
      'traefik.enable': 'true',
    },
  },
  {
    id: 'a-api',
    name: 'alpha-api-1',
    image: 'node:24.20.0-alpine',
    networks: ['dev-gateway', 'alpha_default'],
    exposed: [3000],
    labels: {
      'com.docker.compose.project': 'alpha',
      'com.docker.compose.service': 'api',
      'traefik.enable': 'true',
      'traefik.http.routers.alpha-api.rule': 'Host(`api.alpha.test`)',
      'traefik.http.services.alpha-api.loadbalancer.server.port': '3000',
    },
  },
  {
    // A datastore of an integrated project: on the project network only.
    id: 'a-postgres',
    name: 'alpha-postgres-1',
    image: 'postgres:18.6-alpine',
    health: 'healthy',
    networks: ['alpha_default'],
    exposed: [5432],
    labels: {
      'com.docker.compose.project': 'alpha',
      'com.docker.compose.service': 'postgres',
    },
    mounts: [
      { Type: 'volume', Name: 'alpha_pgdata', Source: '/var/lib/docker/volumes/alpha_pgdata', Destination: '/var/lib/postgresql/data', RW: true },
    ],
  },
  {
    id: 'a-redis',
    name: 'alpha-redis-1',
    image: 'redis:8.10.1-alpine',
    networks: ['alpha_default'],
    exposed: [6379],
    labels: {
      'com.docker.compose.project': 'alpha',
      'com.docker.compose.service': 'redis',
    },
  },
]

export const PROJECT_B: FakeContainer[] = [
  {
    id: 'b-web',
    name: 'beta-web-1',
    image: 'nginx:1.31.4-alpine',
    health: 'unhealthy',
    networks: ['dev-gateway', 'beta_default'],
    exposed: [80],
    labels: {
      'com.docker.compose.project': 'beta',
      'com.docker.compose.service': 'web',
      'com.docker.compose.project.working_dir': '/srv/dev/beta-issue59',
      'traefik.enable': 'true',
    },
  },
]

/** A Compose project that never joined the gateway. */
export const EXTERNAL: FakeContainer[] = [
  {
    id: 'ext-pg',
    name: 'legacy-postgres',
    image: 'postgres:18.6-alpine',
    networks: ['legacy_default'],
    exposed: [5432],
    published: [{ hostIp: '0.0.0.0', hostPort: 5432, containerPort: 5432 }],
    labels: {
      'com.docker.compose.project': 'legacy',
      'com.docker.compose.service': 'postgres',
    },
    mounts: [
      { Type: 'volume', Name: 'legacy_pgdata', Source: '/var/lib/docker/volumes/legacy_pgdata', Destination: '/var/lib/postgresql/data', RW: true },
    ],
  },
]

/** Started by hand, no Compose project at all. */
export const STANDALONE: FakeContainer[] = [
  {
    id: 'solo-mailpit',
    name: 'mailpit',
    image: 'axllent/mailpit:v1.20.0',
    networks: ['bridge'],
    exposed: [1025, 8025],
    published: [{ hostIp: '0.0.0.0', hostPort: 8025, containerPort: 8025 }],
  },
  {
    id: 'solo-old',
    name: 'some-old-container',
    image: 'busybox:1.37.0',
    state: 'exited',
    networks: ['bridge'],
  },
]

export const BRIDGE: FakeContainer = {
  id: 'bridge-1',
  name: 'dg-access-alpha-postgres-ab12cd',
  image: 'alpine/socat:1.8.1.3',
  networks: ['alpha_default'],
  published: [{ hostIp: '127.0.0.1', hostPort: 55431, containerPort: 5432 }],
  labels: {
    'dev-gateway.managed': 'true',
    'dev-gateway.component': 'access-bridge',
    'dev-gateway.access.id': 'ab12cd',
    'dev-gateway.access.project': 'alpha',
    'dev-gateway.access.service': 'postgres',
    'dev-gateway.access.port': '5432',
    'dev-gateway.access.network': 'alpha_default',
    'dev-gateway.access.kind': 'postgres',
    'dev-gateway.access.created': '1700000000',
    'traefik.enable': 'false',
  },
}

export const FULL_HOST: FakeContainer[] = [
  ...GATEWAY,
  ...PROJECT_A,
  ...PROJECT_B,
  ...EXTERNAL,
  ...STANDALONE,
]
