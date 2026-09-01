import { describe, expect, it } from 'vitest'
import { buildSnapshot, collectPorts, hostsFromRules, scopeForHost, urlsFor } from '../../src/server/core/inventory.ts'
import { fakeDocker, testConfig, type FakeContainer } from './helpers.ts'
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
    expect(snapshot.projects.map((p) => p.name)).not.toContain('portta')
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

  it('gives no URL to a database routed by hostname, which has no browser address', () => {
    expect(
      urlsFor(
        {
          'traefik.enable': 'true',
          'com.docker.compose.project': 'alpha',
          'com.docker.compose.service': 'postgres',
          'traefik.tcp.routers.alpha-postgres.rule': 'HostSNIRegexp(`^alpha-postgres\\..+$`)',
        },
        'alpha-postgres-1',
        config,
      ),
    ).toEqual([])
  })

  it('calls a database routed by hostname a database, not an HTTP service', async () => {
    // traefik.enable is set on a TCP-routed datastore too, so keying the kind
    // off that label alone would label PostgreSQL `http` in the panel.
    const { client } = fakeDocker({
      containers: [
        {
          id: 'a-pg',
          name: 'alpha-postgres-1',
          image: 'postgres:18.6-alpine',
          networks: ['alpha_default', 'portta-access'],
          exposed: [5432],
          labels: {
            'com.docker.compose.project': 'alpha',
            'com.docker.compose.service': 'postgres',
            'traefik.enable': 'true',
            'traefik.tcp.routers.alpha-postgres.rule': 'HostSNIRegexp(`^alpha-postgres\\..+$`)',
          },
        },
      ],
    })
    const snapshot = await buildSnapshot(client, config)
    const pg = snapshot.containers.find((c) => c.id === 'a-pg')

    expect(pg?.kind).toBe('postgres')
    expect(pg?.urls).toEqual([])
    expect(pg?.traefikEnabled).toBe(true)
  })

  it('still gives one to a service that is routed over both', () => {
    const urls = urlsFor(
      {
        'traefik.enable': 'true',
        'com.docker.compose.project': 'alpha',
        'com.docker.compose.service': 'web',
        'traefik.tcp.routers.alpha-web.rule': 'HostSNI(`x`)',
        'traefik.http.routers.alpha-web.rule': 'Host(`alpha-web.test`)',
      },
      'alpha-web-1',
      config,
    )
    expect(urls.map((url) => url.host)).toEqual(['alpha-web.test'])
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

describe('the optional identity labels', () => {
  const declaring: FakeContainer[] = [
    {
      id: 'w-web',
      name: 'storefront-issue59-web-1',
      image: 'nginx:1.31.4-alpine',
      networks: ['portta'],
      labels: {
        'com.docker.compose.project': 'storefront-issue59',
        'com.docker.compose.service': 'web',
        'com.docker.compose.project.working_dir': '/srv/dev/storefront-issue59',
        'traefik.enable': 'true',
        'portta.project': 'storefront',
        'portta.repo': 'owner/storefront',
        'portta.git.root': '/srv/dev/storefront-issue59',
      },
    },
    {
      // The datastore declares nothing, which is the normal case.
      id: 'w-pg',
      name: 'storefront-issue59-postgres-1',
      image: 'postgres:18.6-alpine',
      networks: ['storefront_default'],
      labels: {
        'com.docker.compose.project': 'storefront-issue59',
        'com.docker.compose.service': 'postgres',
      },
    },
  ]

  it('reads them onto the container and up onto the project', async () => {
    const { client } = fakeDocker({ containers: declaring })
    const snapshot = await buildSnapshot(client, config)
    const project = snapshot.projects.find((item) => item.name === 'storefront-issue59')

    expect(project?.group).toBe('storefront')
    expect(project?.repo).toBe('owner/storefront')
    expect(project?.repoUrl).toBe('https://github.com/owner/storefront')
    expect(project?.gitRoot).toBe('/srv/dev/storefront-issue59')
  })

  it('takes them from whichever service declared them', async () => {
    const { client } = fakeDocker({ containers: declaring })
    const snapshot = await buildSnapshot(client, config)
    const postgres = snapshot.containers.find((item) => item.id === 'w-pg')
    // The container itself declared nothing, and says so.
    expect(postgres?.group).toBeNull()
    expect(snapshot.projects[0]?.group).toBe('storefront')
  })

  it('keeps inferring the worktree namespace alongside them', async () => {
    const { client } = fakeDocker({ containers: declaring })
    const snapshot = await buildSnapshot(client, config)
    // The directory basename agrees with the project name here, so there is no
    // namespace to infer: the declared group is what groups the worktrees.
    expect(snapshot.projects[0]?.namespace).toBeNull()
    expect(snapshot.projects[0]?.group).toBe('storefront')
  })

  it('leaves a project that declares none exactly as it was', async () => {
    // The guarantee ADR 0010 makes, asserted rather than promised.
    const { client } = fakeDocker({ containers: FULL_HOST })
    const snapshot = await buildSnapshot(client, config)
    for (const project of snapshot.projects) {
      expect(project.group).toBeNull()
      expect(project.repo).toBeNull()
      expect(project.repoUrl).toBeNull()
      expect(project.gitRoot).toBeNull()
    }
    expect(snapshot.projects.find((item) => item.name === 'beta')?.namespace).toBe('beta-issue59')
  })

  it('derives no repository link from a label it cannot parse', async () => {
    const { client } = fakeDocker({
      containers: [
        {
          id: 'bad',
          name: 'x-web-1',
          image: 'nginx:1.31.4-alpine',
          networks: ['portta'],
          labels: {
            'com.docker.compose.project': 'x',
            'com.docker.compose.service': 'web',
            'traefik.enable': 'true',
            'portta.repo': 'not a remote at all',
          },
        },
      ],
    })
    const snapshot = await buildSnapshot(client, config)
    expect(snapshot.projects[0]?.repo).toBe('not a remote at all')
    expect(snapshot.projects[0]?.repoUrl).toBeNull()
  })
})
