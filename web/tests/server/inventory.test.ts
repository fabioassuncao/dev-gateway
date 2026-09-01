import { describe, expect, it } from 'vitest'
import { buildSnapshot, collectPorts, hostsFromRules, scopeForHost, urlsFor } from '../../src/server/core/inventory.ts'
import { fakeDocker, testConfig } from './helpers.ts'
import { BRIDGE, EXTERNAL, FULL_HOST, GATEWAY, PROJECT_A, STANDALONE } from './fixtures.ts'

const config = testConfig()

describe('classification', () => {
  it('separates the gateway, its projects and everything else', async () => {
    const { client } = fakeDocker({ containers: FULL_HOST })
    const snapshot = await buildSnapshot(client, config)
    const owner = (id: string) => snapshot.containers.find((c) => c.id === id)?.ownership

    expect(owner('gw-traefik')).toBe('gateway')
    expect(owner('gw-proxy')).toBe('gateway')
    expect(owner('a-web')).toBe('integrated')
    expect(owner('ext-pg')).toBe('external')
    expect(owner('solo-mailpit')).toBe('standalone')
  })

  it('counts a datastore of an integrated project as part of that project', async () => {
    const { client } = fakeDocker({ containers: [...GATEWAY, ...PROJECT_A] })
    const snapshot = await buildSnapshot(client, config)
    // postgres is on alpha_default only: no gateway network, no Traefik label.
    expect(snapshot.containers.find((c) => c.id === 'a-postgres')?.ownership).toBe('integrated')
  })

  it('does not promote a Compose project that never joined the gateway', async () => {
    const { client } = fakeDocker({ containers: [...GATEWAY, ...EXTERNAL] })
    const snapshot = await buildSnapshot(client, config)
    expect(snapshot.projects.find((p) => p.name === 'legacy')?.integrated).toBe(false)
  })

  it('survives a container that disappears between listing and inspecting', async () => {
    const { client } = fakeDocker({ containers: FULL_HOST, failInspect: ['a-web'] })
    const snapshot = await buildSnapshot(client, config)
    const web = snapshot.containers.find((c) => c.id === 'a-web')
    expect(web).toBeDefined()
    expect(web?.name).toBe('alpha-web-1')
  })
})

describe('projects', () => {
  it('groups services under their Compose project', async () => {
    const { client } = fakeDocker({ containers: FULL_HOST })
    const snapshot = await buildSnapshot(client, config)
    const alpha = snapshot.projects.find((p) => p.name === 'alpha')

    expect(alpha?.integrated).toBe(true)
    expect(alpha?.services.map((s) => s.service)).toEqual(['api', 'postgres', 'redis', 'web'])
    expect(alpha?.serviceCount).toBe(4)
    expect(alpha?.runningCount).toBe(4)
    expect(alpha?.healthyCount).toBe(2)
  })

  it('reports the unhealthy count so the overview can flag it', async () => {
    const { client } = fakeDocker({ containers: FULL_HOST })
    const snapshot = await buildSnapshot(client, config)
    expect(snapshot.projects.find((p) => p.name === 'beta')?.unhealthyCount).toBe(1)
  })

  it('names the worktree when the directory disagrees with the project', async () => {
    const { client } = fakeDocker({ containers: FULL_HOST })
    const snapshot = await buildSnapshot(client, config)
    expect(snapshot.projects.find((p) => p.name === 'beta')?.namespace).toBe('beta-issue59')
    expect(snapshot.projects.find((p) => p.name === 'alpha')?.namespace).toBeNull()
  })

  it('never lists a gateway container as somebody’s service', async () => {
    const { client } = fakeDocker({ containers: FULL_HOST })
    const snapshot = await buildSnapshot(client, config)
    expect(snapshot.projects.map((p) => p.name)).not.toContain('dev-gateway')
  })
})

describe('URLs', () => {
  it('derives the hostname the way Traefik’s default rule does', () => {
    const urls = urlsFor(
      {
        'traefik.enable': 'true',
        'com.docker.compose.project': 'Base Empresarial',
        'com.docker.compose.service': 'web',
      },
      'whatever',
      config,
    )
    expect(urls[0]?.url).toBe('http://base-empresarial-web.localhost')
    expect(urls[0]?.scope).toBe('local')
  })

  it('lets an explicit Host() rule win, exactly like Traefik', () => {
    const urls = urlsFor(
      {
        'traefik.enable': 'true',
        'com.docker.compose.project': 'alpha',
        'com.docker.compose.service': 'api',
        'traefik.http.routers.alpha.rule': 'Host(`api.alpha.test`) || Host(`alt.alpha.test`)',
      },
      'alpha-api-1',
      config,
    )
    expect(urls.map((url) => url.host)).toEqual(['api.alpha.test', 'alt.alpha.test'])
  })

  it('gives no URL to a service that did not opt in', () => {
    expect(urlsFor({ 'com.docker.compose.project': 'alpha' }, 'x', config)).toEqual([])
  })

  it('switches to https when TLS is on', () => {
    const urls = urlsFor(
      { 'traefik.enable': 'true', 'com.docker.compose.project': 'a', 'com.docker.compose.service': 'w' },
      'x',
      testConfig({ tlsEnabled: true }),
    )
    expect(urls[0]?.url.startsWith('https://')).toBe(true)
  })

  it('reads several router rules in a stable order', () => {
    expect(
      hostsFromRules({
        'traefik.http.routers.b.rule': 'Host(`b.test`)',
        'traefik.http.routers.a.rule': 'Host(`a.test`)',
      }),
    ).toEqual(['a.test', 'b.test'])
  })
})

describe('URL scopes', () => {
  const remote = testConfig({
    profile: 'remote-private',
    domain: 'vpn.example.com',
    privateDomain: 'vpn.example.com',
    publicDomain: 'dev.example.com',
  })

  it('tells local, VPN and public apart by their domain', () => {
    expect(scopeForHost('alpha-web.localhost', remote)).toBe('local')
    expect(scopeForHost('alpha-web.vpn.example.com', remote)).toBe('vpn')
    expect(scopeForHost('alpha-web.dev.example.com', remote)).toBe('public')
  })

  it('falls back to what the profile implies for an unfamiliar domain', () => {
    expect(scopeForHost('custom.internal', remote)).toBe('vpn')
    expect(scopeForHost('custom.internal', testConfig())).toBe('local')
    expect(
      scopeForHost('custom.internal', testConfig({ profile: 'remote-public', publicDomain: 'd.test' })),
    ).toBe('public')
  })
})

describe('published ports', () => {
  it('collects what each running container holds on the host', async () => {
    const { client } = fakeDocker({ containers: FULL_HOST })
    const snapshot = await buildSnapshot(client, config)
    const ports = snapshot.ports.map((port) => port.hostPort)
    expect(ports).toEqual([80, 443, 5432, 8025])
  })

  it('flags a port claimed by two containers', () => {
    const usage = collectPorts([
      {
        id: 'one',
        name: 'one',
        state: 'running',
        ownership: 'external',
        ports: [{ ip: '127.0.0.1', hostPort: 3000, containerPort: 3000, protocol: 'tcp' }],
      },
      {
        id: 'two',
        name: 'two',
        state: 'running',
        ownership: 'standalone',
        ports: [{ ip: '0.0.0.0', hostPort: 3000, containerPort: 3000, protocol: 'tcp' }],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any)
    expect(usage).toHaveLength(1)
    expect(usage[0]?.conflict).toBe(true)
    expect(usage[0]?.bindings).toHaveLength(2)
  })

  it('ignores a stopped container’s old mapping', async () => {
    const { client } = fakeDocker({ containers: [...STANDALONE] })
    const snapshot = await buildSnapshot(client, config)
    expect(snapshot.ports.every((port) => port.hostPort !== 0)).toBe(true)
    expect(snapshot.containers.find((c) => c.id === 'solo-old')?.state).toBe('exited')
  })
})

describe('the snapshot cache', () => {
  it('serves one build to concurrent callers', async () => {
    const docker = fakeDocker({ containers: [...GATEWAY, BRIDGE] })
    const { createSnapshotCache } = await import('../../src/server/core/inventory.ts')
    const cache = createSnapshotCache(docker.client, config, 1000)
    await Promise.all([cache.get(), cache.get(), cache.get()])
    expect(docker.calls.filter((call) => call.method === 'listContainers')).toHaveLength(1)
  })
})
