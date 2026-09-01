// The host the documentation screenshots describe.
//
// It is a plausible workstation rather than any particular machine: three
// projects on the gateway (one of them a second worktree of the first), a
// legacy stack that never adopted it, containers somebody started by hand and
// forgot, an open TCP bridge, one unhealthy service and one port claimed
// twice. Everything the panel is for is visible at once, the images are
// reproducible, and no real environment ends up in a public README.
//
// Regenerate the images with: npm run screenshots

import { composeLabels, gatewayLabels, makeBridge, makeContainer, volume } from './container.mjs'

const HOUR = 3600
const DAY = 24 * HOUR

const WHOAMI = 'traefik/whoami:v1.12.0'
const POSTGRES = 'postgres:18.6-alpine'
const REDIS = 'redis:8.10.1-alpine'
const NGINX = 'nginx:1.31.4-alpine'

export function initialState() {
  return [
    // ---- the gateway itself ------------------------------------------
    makeContainer({
      id: 'gwtraefik',
      name: 'portta-traefik-1',
      image: 'traefik:v3.7.12',
      health: 'healthy',
      networks: ['portta', 'portta-control'],
      labels: gatewayLabels('traefik'),
      published: [
        { hostIp: '127.0.0.1', hostPort: 80, containerPort: 80 },
        { hostIp: '127.0.0.1', hostPort: 443, containerPort: 443 },
      ],
      upSeconds: 6 * DAY,
    }),
    makeContainer({
      id: 'gwproxy',
      name: 'portta-socket-proxy-1',
      image: 'tecnativa/docker-socket-proxy:v0.5.0',
      health: 'healthy',
      networks: ['portta-control'],
      labels: gatewayLabels('socket-proxy'),
      upSeconds: 6 * DAY,
    }),
    makeContainer({
      id: 'gwweb',
      name: 'portta-web-1',
      image: 'fabioassuncao/portta:local',
      health: 'healthy',
      networks: ['portta', 'portta-web'],
      labels: gatewayLabels('web'),
      published: [{ hostIp: '127.0.0.1', hostPort: 8081, containerPort: 8081 }],
      upSeconds: 4 * HOUR,
    }),
    makeContainer({
      id: 'gwwebproxy',
      name: 'portta-web-socket-proxy-1',
      image: 'tecnativa/docker-socket-proxy:v0.5.0',
      health: 'healthy',
      networks: ['portta-web'],
      labels: gatewayLabels('web-socket-proxy'),
      upSeconds: 4 * HOUR,
    }),

    // ---- storefront: the project being worked on ----------------------
    makeContainer({
      id: 'sfweb',
      name: 'storefront-web-1',
      image: NGINX,
      health: 'healthy',
      networks: ['portta', 'storefront_default'],
      exposed: [3000],
      labels: {
        ...composeLabels({
          project: 'storefront',
          service: 'web',
          workingDir: '/Projects/storefront',
          routed: true,
          port: 3000,
        }),
        'traefik.http.routers.storefront-web.rule':
          'Host(`storefront-web.localhost`) || Host(`storefront-preview.localhost`)',
      },
      upSeconds: 3 * HOUR,
    }),
    makeContainer({
      id: 'sfapi',
      name: 'storefront-api-1',
      image: WHOAMI,
      health: 'healthy',
      networks: ['portta', 'storefront_default'],
      exposed: [8000],
      labels: composeLabels({
        project: 'storefront',
        service: 'api',
        workingDir: '/Projects/storefront',
        routed: true,
        port: 8000,
      }),
      upSeconds: 3 * HOUR,
    }),
    makeContainer({
      id: 'sfpg',
      name: 'storefront-postgres-1',
      image: POSTGRES,
      health: 'healthy',
      networks: ['storefront_default', 'portta-access'],
      exposed: [5432],
      labels: {
        ...composeLabels({
          project: 'storefront',
          service: 'postgres',
          workingDir: '/Projects/storefront',
        }),
        // Opted into hostname routing: reachable at
        // storefront-postgres.localhost:5432 without publishing a port.
        'traefik.enable': 'true',
        'traefik.docker.network': 'portta-access',
        'traefik.tcp.routers.storefront-postgres.rule':
          'HostSNIRegexp(`^storefront-postgres\\..+$`)',
        'traefik.tcp.routers.storefront-postgres.tls': 'true',
        'traefik.tcp.routers.storefront-postgres.tls.options': 'postgres@file',
      },
      mounts: [volume('storefront_pgdata', '/var/lib/postgresql')],
      upSeconds: 3 * HOUR,
    }),
    makeContainer({
      id: 'sfredis',
      name: 'storefront-redis-1',
      image: REDIS,
      health: 'healthy',
      networks: ['storefront_default', 'portta-access'],
      exposed: [6379],
      labels: {
        ...composeLabels({
          project: 'storefront',
          service: 'redis',
          workingDir: '/Projects/storefront',
        }),
        'traefik.enable': 'true',
        'traefik.docker.network': 'portta-access',
        'traefik.tcp.routers.storefront-redis.rule': 'HostSNIRegexp(`^storefront-redis\\..+$`)',
        'traefik.tcp.routers.storefront-redis.tls': 'true',
      },
      upSeconds: 3 * HOUR,
    }),

    // ---- the same project, a second worktree, running side by side ----
    makeContainer({
      id: 'sf312web',
      name: 'storefront-issue312-web-1',
      image: WHOAMI,
      health: 'healthy',
      networks: ['portta', 'storefront-issue312_default'],
      exposed: [3000],
      labels: composeLabels({
        project: 'storefront-issue312',
        service: 'web',
        workingDir: '/Projects/worktrees/issue-312',
        routed: true,
        port: 3000,
      }),
      upSeconds: 40 * 60,
    }),
    makeContainer({
      id: 'sf312api',
      name: 'storefront-issue312-api-1',
      image: WHOAMI,
      networks: ['portta', 'storefront-issue312_default'],
      exposed: [8000],
      labels: composeLabels({
        project: 'storefront-issue312',
        service: 'api',
        workingDir: '/Projects/worktrees/issue-312',
        routed: true,
        port: 8000,
      }),
      upSeconds: 40 * 60,
    }),
    makeContainer({
      id: 'sf312pg',
      name: 'storefront-issue312-postgres-1',
      image: POSTGRES,
      health: 'healthy',
      networks: ['storefront-issue312_default'],
      exposed: [5432],
      labels: composeLabels({
        project: 'storefront-issue312',
        service: 'postgres',
        workingDir: '/Projects/worktrees/issue-312',
      }),
      mounts: [volume('storefront-issue312_pgdata', '/var/lib/postgresql')],
      upSeconds: 40 * 60,
    }),

    // ---- checkout: another project, with something wrong with it ------
    makeContainer({
      id: 'ckweb',
      name: 'checkout-web-1',
      image: WHOAMI,
      health: 'healthy',
      networks: ['portta', 'checkout_default'],
      exposed: [3000],
      labels: composeLabels({
        project: 'checkout',
        service: 'web',
        workingDir: '/Projects/checkout',
        routed: true,
        port: 3000,
      }),
      upSeconds: 26 * HOUR,
    }),
    makeContainer({
      id: 'ckworker',
      name: 'checkout-worker-1',
      image: 'python:3.13-alpine',
      health: 'unhealthy',
      networks: ['checkout_default'],
      labels: composeLabels({
        project: 'checkout',
        service: 'worker',
        workingDir: '/Projects/checkout',
      }),
      upSeconds: 26 * HOUR,
    }),
    makeContainer({
      id: 'ckpg',
      name: 'checkout-postgres-1',
      image: POSTGRES,
      health: 'healthy',
      networks: ['checkout_default'],
      exposed: [5432],
      labels: composeLabels({
        project: 'checkout',
        service: 'postgres',
        workingDir: '/Projects/checkout',
      }),
      mounts: [volume('checkout_pgdata', '/var/lib/postgresql')],
      upSeconds: 26 * HOUR,
    }),

    makeContainer({
      id: 'cklegacy',
      name: 'checkout-mysql-1',
      image: 'mariadb:11.4.9',
      health: 'healthy',
      networks: ['checkout_default'],
      exposed: [3306],
      labels: composeLabels({
        project: 'checkout',
        service: 'mysql',
        workingDir: '/Projects/checkout',
      }),
      mounts: [volume('checkout_mysqldata', '/var/lib/mysql')],
      upSeconds: 26 * HOUR,
    }),

    makeContainer({
      id: 'ckmail',
      name: 'checkout-mailpit-1',
      image: 'axllent/mailpit:v1.31.0',
      health: 'healthy',
      networks: ['portta', 'checkout_default'],
      exposed: [8025, 1025],
      labels: {
        ...composeLabels({
          project: 'checkout',
          service: 'mailpit',
          workingDir: '/Projects/checkout',
          routed: true,
          port: 8025,
        }),
        'traefik.http.routers.checkout-mailpit.rule':
          'Host(`checkout-mailpit.localhost`) || Host(`mail.checkout.localhost`)',
      },
      upSeconds: 26 * HOUR,
    }),
    makeContainer({
      id: 'ckrustfs',
      name: 'checkout-rustfs-1',
      image: 'rustfs/rustfs:1.0.0-rc.4',
      health: 'healthy',
      networks: ['portta', 'checkout_default'],
      exposed: [9000, 9001],
      labels: composeLabels({
        project: 'checkout',
        service: 'rustfs',
        workingDir: '/Projects/checkout',
        routed: true,
        port: 9001,
      }),
      mounts: [volume('checkout_rustfsdata', '/data')],
      upSeconds: 26 * HOUR,
    }),

    // ---- a stack that never adopted the gateway -----------------------
    makeContainer({
      id: 'lgapi',
      name: 'legacy-billing-api-1',
      image: 'legacy-billing-api:dev',
      networks: ['legacy-billing_default'],
      exposed: [8000],
      published: [{ hostIp: '127.0.0.1', hostPort: 8090, containerPort: 8000 }],
      labels: composeLabels({
        project: 'legacy-billing',
        service: 'api',
        workingDir: '/Projects/legacy-billing',
      }),
      upSeconds: 9 * DAY,
    }),
    makeContainer({
      id: 'lgpg',
      name: 'legacy-billing-postgres-1',
      image: 'postgres:14-alpine',
      health: 'healthy',
      networks: ['legacy-billing_default'],
      exposed: [5432],
      published: [{ hostIp: '127.0.0.1', hostPort: 5432, containerPort: 5432 }],
      labels: composeLabels({
        project: 'legacy-billing',
        service: 'postgres',
        workingDir: '/Projects/legacy-billing',
      }),
      mounts: [volume('legacy-billing_pgdata', '/var/lib/postgresql/data')],
      upSeconds: 9 * DAY,
    }),

    // ---- started by hand, and forgotten -------------------------------
    makeContainer({
      id: 'mailpit',
      name: 'mailpit',
      image: 'axllent/mailpit:v1.31.0',
      health: 'healthy',
      networks: ['bridge'],
      exposed: [1025],
      published: [{ hostIp: '0.0.0.0', hostPort: 8025, containerPort: 8025 }],
      upSeconds: 21 * DAY,
    }),
    makeContainer({
      id: 'pgscratch',
      name: 'pg-scratch',
      image: 'postgres:16-alpine',
      networks: ['bridge'],
      exposed: [5432],
      // A second claim on 5432, on another interface. The panel flags it, and
      // this is usually the answer to "why will my database not start".
      published: [{ hostIp: '192.168.64.2', hostPort: 5432, containerPort: 5432 }],
      mounts: [volume('pg-scratch-data', '/var/lib/postgresql/data')],
      upSeconds: 5 * DAY,
    }),
    makeContainer({
      id: 'oldbox',
      name: 'import-script-run',
      image: 'alpine:3.24.1',
      state: 'exited',
      networks: ['bridge'],
      upSeconds: 0,
    }),

    // ---- an access bridge somebody opened this morning ----------------
    makeBridge({
      id: 'bridge1',
      name: 'portta-access-storefront-postgres-a41f2c',
      targetPort: 5432,
      hostPort: 55431,
      network: 'storefront_default',
      labels: {
        'portta.managed': 'true',
        'portta.component': 'access-bridge',
        'portta.access.id': 'a41f2c',
        'portta.access.project': 'storefront',
        'portta.access.service': 'postgres',
        'portta.access.port': '5432',
        'portta.access.network': 'storefront_default',
        'portta.access.kind': 'postgres',
        'portta.access.created': String(Math.floor(Date.now() / 1000) - 900),
        'traefik.enable': 'false',
      },
    }),
  ]
}

function network(name, { internal = false, managed = false } = {}) {
  return {
    Id: `net-${name}`,
    Name: name,
    Driver: 'bridge',
    Scope: 'local',
    Internal: internal,
    Labels: managed ? { 'portta.managed': 'true' } : {},
    Containers: {},
  }
}

/** What `GET /info` answers. A plausible workstation, not this machine. */
export const INFO = {
  Name: 'workstation',
  Images: 64,
  NCPU: 10,
  MemTotal: 34_359_738_368,
  OperatingSystem: 'OrbStack',
  Architecture: 'aarch64',
  ServerVersion: '29.4.0',
}

export const NETWORKS = [
  network('portta', { managed: true }),
  network('portta-control', { internal: true, managed: true }),
  network('portta-web', { internal: true, managed: true }),
  network('portta-access', { managed: true }),
  network('storefront_default'),
  network('storefront-issue312_default'),
  network('checkout_default'),
  network('legacy-billing_default'),
  network('bridge'),
]
