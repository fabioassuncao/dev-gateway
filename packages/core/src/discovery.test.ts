import { describe, expect, it } from 'vitest'
import {
  BRIDGE_IMAGE,
  SENSITIVE_KINDS,
  connectionString,
  defaultPortForImage,
  gatewayConnectionString,
  isHostnameRoutable,
  isSensitiveKind,
  serviceKind,
  tcpEntrypoint,
  tcpHostPort,
  tcpHostname,
  tcpRouting,
} from './discovery.ts'

describe('serviceKind', () => {
  it('reads the family from the image reference, not the tag', () => {
    expect(serviceKind('postgres:18.6-alpine')).toBe('postgres')
    expect(serviceKind('postgis/postgis:16-3.4')).toBe('postgres')
    expect(serviceKind('timescale/timescaledb:latest-pg16')).toBe('postgres')
    expect(serviceKind('mariadb:11')).toBe('mysql')
    expect(serviceKind('percona:8')).toBe('mysql')
    expect(serviceKind('valkey/valkey:8')).toBe('redis')
    expect(serviceKind('mongo:7')).toBe('mongodb')
    expect(serviceKind('opensearchproject/opensearch:2')).toBe('search')
    expect(serviceKind('rabbitmq:3-management')).toBe('amqp')
    expect(serviceKind('axllent/mailpit:latest')).toBe('smtp')
  })

  it('is case-insensitive, because a registry path need not be lower-cased', () => {
    expect(serviceKind('ghcr.io/Acme/PostgreSQL:16')).toBe('postgres')
  })

  it('falls back to tcp rather than guessing', () => {
    expect(serviceKind('nginx:1.27')).toBe('tcp')
    expect(serviceKind('')).toBe('tcp')
  })

  // Cassandra and Neo4j are reached as plain TCP, so they carry no kind of
  // their own — but the shell knew their ports and neither TypeScript copy
  // did, which is how `access open` came to guess nothing for them.
  it('classifies Cassandra and Neo4j as tcp while still knowing their ports', () => {
    expect(serviceKind('cassandra:5')).toBe('tcp')
    expect(defaultPortForImage('cassandra:5')).toBe(9042)
    expect(serviceKind('neo4j:5')).toBe('tcp')
    expect(defaultPortForImage('neo4j:5')).toBe(7687)
  })
})

describe('defaultPortForImage', () => {
  it('answers with the well-known port for every family in the table', () => {
    expect(defaultPortForImage('postgres:18')).toBe(5432)
    expect(defaultPortForImage('mysql:8')).toBe(3306)
    expect(defaultPortForImage('redis:7')).toBe(6379)
    expect(defaultPortForImage('mongo:7')).toBe(27017)
    expect(defaultPortForImage('memcached:1.6')).toBe(11211)
    expect(defaultPortForImage('elasticsearch:8')).toBe(9200)
    expect(defaultPortForImage('rabbitmq:3')).toBe(5672)
    expect(defaultPortForImage('clickhouse/clickhouse-server:24')).toBe(9000)
    expect(defaultPortForImage('axllent/mailpit')).toBe(1025)
  })

  it('answers null when it does not know, so the caller asks instead of guessing', () => {
    expect(defaultPortForImage('nginx:1.27')).toBeNull()
  })
})

describe('sensitive kinds', () => {
  it('covers every datastore in the table', () => {
    for (const kind of SENSITIVE_KINDS) expect(isSensitiveKind(kind)).toBe(true)
  })

  // `tcp` means "nothing is known about this", and a refusal has to name a
  // reason. Adding it here would refuse every unclassified service.
  it('does not include tcp, smtp or http', () => {
    expect(isSensitiveKind('tcp')).toBe(false)
    expect(isSensitiveKind('smtp')).toBe(false)
    expect(isSensitiveKind('http')).toBe(false)
  })
})

describe('tcp routing', () => {
  it('carries only verdicts that were measured with two live instances', () => {
    expect(tcpRouting('postgres')).toBe('starttls-sni')
    expect(tcpRouting('redis')).toBe('tls-sni')
    expect(tcpRouting('mysql')).toBe('unsupported')
  })

  it('treats anything untested as unevaluated, never as routable', () => {
    expect(tcpRouting('mongodb')).toBe('unevaluated')
    expect(tcpRouting('clickhouse')).toBe('unevaluated')
    expect(isHostnameRoutable('mongodb')).toBe(false)
  })

  it('offers an entrypoint and a host port exactly where it is routable', () => {
    expect(isHostnameRoutable('postgres')).toBe(true)
    expect(tcpEntrypoint('postgres')).toBe('postgres')
    expect(tcpHostPort('postgres')).toBe(5432)
    expect(isHostnameRoutable('redis')).toBe(true)
    expect(tcpEntrypoint('redis')).toBe('redis')
    expect(tcpHostPort('redis')).toBe(6379)

    expect(tcpEntrypoint('mysql')).toBeNull()
    expect(tcpHostPort('mysql')).toBeNull()
  })

  it('reads a moved host port from the environment', () => {
    expect(tcpHostPort('postgres', { PORTTA_TCP_POSTGRES_PORT: '15432' })).toBe(15432)
    expect(tcpHostPort('redis', { PORTTA_TCP_REDIS_PORT: '' })).toBe(6379)
  })
})

describe('tcpHostname', () => {
  // One label, because a wildcard certificate covers exactly one.
  it('puts the whole name in one label and slugs both halves', () => {
    expect(tcpHostname('storefront', 'postgres', 'dev.example.com')).toBe('storefront-postgres.dev.example.com')
    expect(tcpHostname('My Shop', 'Main_DB', 'example.com')).toBe('my-shop-main-db.example.com')
  })

  it('falls back to localhost when no domain is configured', () => {
    expect(tcpHostname('alpha', 'redis', '')).toBe('alpha-redis.localhost')
  })
})

describe('connection strings', () => {
  it('never contains a credential, only a placeholder', () => {
    for (const kind of ['postgres', 'mysql', 'mongodb', 'clickhouse', 'amqp'] as const) {
      expect(connectionString(kind, 'host', 1)).toContain('<user>')
    }
    expect(connectionString('redis', '127.0.0.1', 6379)).toBe('redis://127.0.0.1:6379')
    expect(connectionString('tcp', '127.0.0.1', 9999)).toBe('127.0.0.1:9999')
  })

  it('fills in discovered credentials without changing the template callers', () => {
    expect(connectionString('postgres', 'db.localhost', 5432, {
      user: 'shop', password: 'p@ss', database: 'store',
    })).toBe('postgresql://shop:p%40ss@db.localhost:5432/store')
    expect(connectionString('redis', 'cache.localhost', 6379, { password: 'r' })).toBe(
      'redis://:r@cache.localhost:6379',
    )
  })

  // redis-cli does not derive SNI from -h, so the flag is the whole point.
  it('tells a gateway client which instance it wants', () => {
    expect(gatewayConnectionString('postgres', 'a-db.example.com', 5432)).toContain('sslmode=require')
    expect(gatewayConnectionString('redis', 'a-redis.example.com', 6379)).toContain('--sni a-redis.example.com')
    expect(gatewayConnectionString('tcp', 'host', 1)).toBe('host:1')
  })
})

it('pins the bridge image, which ADR 0004 requires', () => {
  expect(BRIDGE_IMAGE).toMatch(/^alpine\/socat:\d+\.\d+/)
})
