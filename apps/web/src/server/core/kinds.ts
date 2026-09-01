// Mirrors portta_service_kind and portta_default_port_for_image in
// scripts/lib/discovery.sh. The CLI and the panel must agree on what a service
// is, or `access open` from one would contradict the other.

import type { ServiceKind, TcpRouting } from '../../shared/types.ts'

const KIND_RULES: { match: RegExp; kind: ServiceKind; port: number }[] = [
  { match: /postgres|postgis|timescale/, kind: 'postgres', port: 5432 },
  { match: /mysql|mariadb|percona/, kind: 'mysql', port: 3306 },
  { match: /redis|valkey|keydb/, kind: 'redis', port: 6379 },
  { match: /mongo/, kind: 'mongodb', port: 27017 },
  { match: /memcached/, kind: 'memcached', port: 11211 },
  { match: /elasticsearch|opensearch/, kind: 'search', port: 9200 },
  { match: /rabbitmq/, kind: 'amqp', port: 5672 },
  { match: /clickhouse/, kind: 'clickhouse', port: 9000 },
  { match: /mailpit|mailhog/, kind: 'smtp', port: 1025 },
]

export function serviceKind(image: string): ServiceKind {
  const lower = (image ?? '').toLowerCase()
  return KIND_RULES.find((rule) => rule.match.test(lower))?.kind ?? 'tcp'
}

export function defaultPortForImage(image: string): number | null {
  const lower = (image ?? '').toLowerCase()
  return KIND_RULES.find((rule) => rule.match.test(lower))?.port ?? null
}

/** Datastores the gateway refuses to publish publicly, mirroring the CLI. */
export const SENSITIVE_KINDS: ServiceKind[] = [
  'postgres',
  'mysql',
  'redis',
  'mongodb',
  'memcached',
  'search',
  'amqp',
  'clickhouse',
]

/**
 * Whether a protocol can be told apart by hostname on a shared port, and how.
 * The CLI has the same table in scripts/lib/discovery.sh; both were filled in
 * from tests with two live instances, never from what a neighbouring protocol
 * happens to do. See docs/tcp-routing.md.
 *
 *   starttls-sni  client opens in plaintext, asks to upgrade, then sends SNI
 *   tls-sni       client sends a TLS ClientHello first, so SNI is there at once
 *   unsupported   the server speaks first, so there is no SNI to route on
 *   unevaluated   not tested, and therefore not offered
 */
const TCP_ROUTING: Partial<Record<ServiceKind, TcpRouting>> = {
  postgres: 'starttls-sni',
  redis: 'tls-sni',
  mysql: 'unsupported',
}

export function tcpRouting(kind: ServiceKind): TcpRouting {
  return TCP_ROUTING[kind] ?? 'unevaluated'
}

export function isHostnameRoutable(kind: ServiceKind): boolean {
  const routing = tcpRouting(kind)
  return routing === 'starttls-sni' || routing === 'tls-sni'
}

/**
 * How a client is told which instance it wants. PostgreSQL puts it in the
 * connection string; redis-cli needs an explicit flag, because it does not
 * derive SNI from -h.
 */
export function gatewayConnectionString(kind: ServiceKind, host: string, port: number): string {
  switch (kind) {
    case 'postgres':
      return `postgresql://<user>@${host}:${port}/<database>?sslmode=require`
    case 'redis':
      return `redis-cli -h 127.0.0.1 -p ${port} --tls --sni ${host}`
    default:
      return `${host}:${port}`
  }
}

/** A connection string template. Credentials come from the project, never from here. */
export function connectionString(kind: ServiceKind, host: string, port: number): string {
  switch (kind) {
    case 'postgres':
      return `postgresql://<user>@${host}:${port}/<database>`
    case 'mysql':
      return `mysql://<user>@${host}:${port}/<database>`
    case 'redis':
      return `redis://${host}:${port}`
    case 'mongodb':
      return `mongodb://<user>@${host}:${port}/<database>`
    case 'clickhouse':
      return `clickhouse://<user>@${host}:${port}/<database>`
    case 'amqp':
      return `amqp://<user>@${host}:${port}/`
    default:
      return `${host}:${port}`
  }
}
