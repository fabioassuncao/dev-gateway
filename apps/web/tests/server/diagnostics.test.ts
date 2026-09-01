import { describe, expect, it } from 'vitest'
import { buildSnapshot } from '../../src/server/core/inventory.ts'
import { diagnose, problemsOnly } from '../../src/server/core/diagnostics.ts'
import { fakeDocker, testConfig, type FakeContainer } from './helpers.ts'
import { EXTERNAL, FULL_HOST, GATEWAY, PROJECT_A } from './fixtures.ts'

async function check(containers: FakeContainer[], overrides = {}) {
  const config = testConfig(overrides)
  const { client } = fakeDocker({ containers })
  const snapshot = await buildSnapshot(client, config)
  return diagnose(snapshot, config)
}

const find = (checks: Awaited<ReturnType<typeof check>>, id: string) =>
  checks.find((entry) => entry.id === id)

describe('diagnostics', () => {
  it('passes on a healthy local gateway', async () => {
    const checks = await check([...GATEWAY, ...PROJECT_A])
    expect(find(checks, 'traefik')?.status).toBe('pass')
    expect(find(checks, 'socket-proxy')?.status).toBe('pass')
    expect(find(checks, 'network')?.status).toBe('pass')
    expect(find(checks, 'routes-off-network')?.status).toBe('pass')
  })

  it('catches the most common adoption mistake: routed but off the network', async () => {
    const checks = await check([
      ...GATEWAY,
      {
        id: 'stray',
        name: 'stray-web-1',
        image: 'nginx:1.31.4-alpine',
        networks: ['stray_default'],
        labels: {
          'com.docker.compose.project': 'stray',
          'com.docker.compose.service': 'web',
          'traefik.enable': 'true',
        },
      },
    ])
    const problem = find(checks, 'routes-off-network')
    expect(problem?.status).toBe('fail')
    expect(problem?.detail).toContain('stray-web-1')
    expect(problem?.fix).toContain('portta')
  })

  it('catches two containers claiming the same hostname', async () => {
    const duplicate = {
      id: 'dupe',
      name: 'other-web-1',
      image: 'nginx:1.31.4-alpine',
      networks: ['portta'],
      labels: {
        'com.docker.compose.project': 'other',
        'com.docker.compose.service': 'web',
        'traefik.enable': 'true',
        'traefik.http.routers.other.rule': 'Host(`alpha-web.localhost`)',
      },
    }
    const checks = await check([...GATEWAY, ...PROJECT_A, duplicate])
    const problem = find(checks, 'hostname-collision')
    expect(problem?.status).toBe('fail')
    expect(problem?.detail).toContain('alpha-web.localhost')
  })

  it('warns when something else holds the gateway ports', async () => {
    const checks = await check([
      ...GATEWAY,
      {
        id: 'squatter',
        name: 'other-proxy',
        image: 'nginx:1.31.4-alpine',
        networks: ['bridge'],
        published: [{ hostIp: '0.0.0.0', hostPort: 80, containerPort: 80 }],
      },
    ])
    const problem = find(checks, 'gateway-ports')
    expect(problem?.status).toBe('warn')
    expect(problem?.detail).toContain('other-proxy')
  })

  it('reports a missing shared network as a failure', async () => {
    const config = testConfig()
    const { client } = fakeDocker({ containers: GATEWAY, networks: [{ Name: 'bridge' }] })
    const snapshot = await buildSnapshot(client, config)
    expect(find(diagnose(snapshot, config), 'network')?.status).toBe('fail')
  })

  it('flags an expired bridge so `access gc` gets run', async () => {
    const checks = await check([
      ...GATEWAY,
      {
        id: 'old-bridge',
        name: 'portta-access-alpha-postgres-old',
        image: 'alpine/socat:1.8.1.3',
        networks: ['alpha_default'],
        labels: {
          'portta.managed': 'true',
          'portta.component': 'access-bridge',
          'portta.access.id': 'old123',
          'portta.access.expires': '1000',
        },
      },
    ])
    expect(find(checks, 'stale-bridges')?.fix).toBe('portta access gc')
  })

  it('refuses to guess when Docker is unreachable', async () => {
    const config = testConfig()
    const client = {
      listContainers: () => Promise.reject(new Error('down')),
      listNetworks: () => Promise.reject(new Error('down')),
      info: () => Promise.reject(new Error('down')),
      version: () => Promise.reject(new Error('down')),
      inspect: () => Promise.reject(new Error('down')),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
    const snapshot = await buildSnapshot(client, config)
    const checks = diagnose(snapshot, config)
    expect(checks).toHaveLength(1)
    expect(checks[0]?.status).toBe('fail')
  })

  it('says so when the internet can reach the gateway', async () => {
    const checks = await check([...GATEWAY], {
      profile: 'remote-public',
      publicEnabled: true,
      publicDomain: 'dev.example.com',
    })
    expect(find(checks, 'public')?.status).toBe('warn')
  })

  it('separates problems from the checks that passed', async () => {
    const checks = await check([...GATEWAY, ...PROJECT_A, ...EXTERNAL])
    expect(problemsOnly(checks).every((problem) => problem.status !== 'pass')).toBe(true)
  })

  it('does not invent a problem out of an external container', async () => {
    const checks = await check([...GATEWAY, ...EXTERNAL])
    expect(problemsOnly(checks)).toHaveLength(0)
  })

  it('checks the whole host, not only the gateway’s own projects', async () => {
    const checks = await check(FULL_HOST)
    expect(find(checks, 'unhealthy')?.detail).toContain('beta-web-1')
  })
})

describe('the panel judges its own front door', () => {
  const CREDENTIAL = {
    webAuth: 'basic',
    webAuthUser: 'dev',
    webAuthHash: '$apr1$abcdefgh$ckT15POyCRlen.h6XtGAZ1',
  }

  it('says nothing is needed on loopback', async () => {
    const checks = await check(GATEWAY, { webExpose: 'local' })
    expect(find(checks, 'panel-auth')?.status).toBe('pass')
    expect(find(checks, 'panel-read-only')).toBeUndefined()
  })

  it('fails, not warns, when the panel is routed with nothing in front of it', async () => {
    const checks = await check(GATEWAY, { webExpose: 'vpn', webAuth: 'none' })
    const auth = find(checks, 'panel-auth')
    expect(auth?.status).toBe('fail')
    expect(auth?.fix).toBe('portta web auth set')
  })

  it('treats basic without a credential as no protection at all', async () => {
    const checks = await check(GATEWAY, { webExpose: 'vpn', webAuth: 'basic', webAuthUser: '' })
    expect(find(checks, 'panel-auth')?.status).toBe('fail')
  })

  it('passes once a credential exists, and names the user', async () => {
    const checks = await check(GATEWAY, { webExpose: 'vpn', ...CREDENTIAL })
    expect(find(checks, 'panel-auth')?.status).toBe('pass')
    expect(find(checks, 'panel-auth')?.detail).toContain('dev')
  })

  it('warns about a routed panel that can still stop containers', async () => {
    const checks = await check(GATEWAY, { webExpose: 'vpn', readOnly: false, ...CREDENTIAL })
    expect(find(checks, 'panel-read-only')?.status).toBe('warn')

    const readOnly = await check(GATEWAY, { webExpose: 'vpn', readOnly: true, ...CREDENTIAL })
    expect(find(readOnly, 'panel-read-only')).toBeUndefined()
  })

  it('warns when the middleware file does not match the settings', async () => {
    // No dynamic directory in the test environment, so the rendered file is
    // missing: which is exactly the locked-out case worth reporting.
    const checks = await check(GATEWAY, { webExpose: 'vpn', ...CREDENTIAL })
    expect(find(checks, 'panel-auth-file')?.status).toBe('warn')
  })

  it('never puts the hash in a diagnostic', async () => {
    const checks = await check(GATEWAY, { webExpose: 'vpn', ...CREDENTIAL })
    expect(JSON.stringify(checks)).not.toContain('ckT15POyCRlen')
  })
})
