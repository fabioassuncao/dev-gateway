import { describe, expect, it } from 'vitest'
import { del, makeApp, post } from './helpers.ts'
import { BRIDGE, EXTERNAL, FULL_HOST, GATEWAY, PROJECT_A } from './fixtures.ts'
import type { AccessView } from '../../src/shared/types.ts'

const fast = { bridgeSettleMs: 0 }

describe('GET /api/access', () => {
  it('lists the TCP services a bridge could reach', async () => {
    const { app } = makeApp({ containers: FULL_HOST }, fast)
    const view = (await (await app.request('/api/access')).json()) as AccessView
    const names = view.services.map((service) => `${service.project}/${service.service}`)

    expect(names).toContain('alpha/postgres')
    expect(names).toContain('alpha/redis')
    expect(names).toContain('legacy/postgres')
    // An HTTP service is reached by hostname, not by a bridge.
    expect(names).not.toContain('alpha/web')
  })

  it('names the kind and the port a client would use', async () => {
    const { app } = makeApp({ containers: FULL_HOST }, fast)
    const view = (await (await app.request('/api/access')).json()) as AccessView
    const postgres = view.services.find((service) => service.service === 'postgres')
    expect(postgres?.kind).toBe('postgres')
    expect(postgres?.defaultPort).toBe(5432)
    expect(postgres?.privateNetworks).toEqual(['alpha_default'])
  })

  it('shows an open bridge with a connection string that carries no password', async () => {
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A, BRIDGE] }, fast)
    const view = (await (await app.request('/api/access')).json()) as AccessView

    expect(view.bridges).toHaveLength(1)
    expect(view.bridges[0]).toMatchObject({
      id: 'ab12cd',
      project: 'alpha',
      service: 'postgres',
      localPort: 55431,
      bindIp: '127.0.0.1',
      connectionString: 'postgresql://<user>@127.0.0.1:55431/<database>',
    })
    expect(view.bridges[0]?.connectionString).not.toMatch(/password|secret/i)
  })

  it('attaches the open bridge to the service it belongs to', async () => {
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A, BRIDGE] }, fast)
    const view = (await (await app.request('/api/access')).json()) as AccessView
    const postgres = view.services.find((service) => service.service === 'postgres')
    expect(postgres?.bridge?.id).toBe('ab12cd')
  })
})

describe('POST /api/access', () => {
  it('creates the same bridge the CLI creates', async () => {
    const { app, docker } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, fast)
    const response = await post(app, '/api/access', { project: 'alpha', service: 'postgres' })
    expect(response.status).toBe(201)

    const spec = docker.created[0] as {
      name: string
      network: string
      targetPort: number
      bindIp: string
      labels: Record<string, string>
    }
    expect(spec.network).toBe('alpha_default')
    expect(spec.targetPort).toBe(5432)
    expect(spec.bindIp).toBe('127.0.0.1')
    expect(spec.name).toMatch(/^dg-access-alpha-postgres-[0-9a-f]{6}$/)
    expect(spec.labels['dev-gateway.managed']).toBe('true')
    expect(spec.labels['dev-gateway.component']).toBe('access-bridge')
    expect(spec.labels['dev-gateway.access.project']).toBe('alpha')
    expect(spec.labels['traefik.enable']).toBe('false')
  })

  it('reuses an open bridge instead of opening a second one', async () => {
    const { app, docker } = makeApp({ containers: [...GATEWAY, ...PROJECT_A, BRIDGE] }, fast)
    const response = await post(app, '/api/access', { project: 'alpha', service: 'postgres' })
    expect(response.status).toBe(201)
    expect(docker.created).toHaveLength(0)
  })

  it('refuses a service that is not running', async () => {
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, fast)
    const response = await post(app, '/api/access', { project: 'alpha', service: 'nope' })
    expect(response.status).toBe(404)
  })

  it('refuses a service with no private network to join', async () => {
    const { app } = makeApp(
      {
        containers: [
          ...GATEWAY,
          {
            id: 'lonely',
            name: 'lonely',
            image: 'postgres:18.6-alpine',
            networks: ['dev-gateway'],
            exposed: [5432],
            labels: {
              'com.docker.compose.project': 'lonely',
              'com.docker.compose.service': 'postgres',
            },
          },
        ],
      },
      fast,
    )
    const response = await post(app, '/api/access', { project: 'lonely', service: 'postgres' })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('private network') })
  })

  it('validates its input rather than trusting it', async () => {
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, fast)
    for (const body of [
      { project: '../etc', service: 'postgres' },
      { project: 'alpha', service: 'postgres', port: 0 },
      { project: 'alpha', service: 'postgres', port: 70000 },
      { project: 'alpha', service: 'postgres', localPort: 80 },
      { project: 'alpha', service: 'postgres', ttlSeconds: 5 },
      { project: 'alpha', service: 'postgres', extra: 'field' },
      {},
    ]) {
      expect((await post(app, '/api/access', body)).status, JSON.stringify(body)).toBe(400)
    }
  })

  it('works on an external project too: it is just Docker', async () => {
    const { app, docker } = makeApp({ containers: [...GATEWAY, ...EXTERNAL] }, fast)
    expect((await post(app, '/api/access', { project: 'legacy', service: 'postgres' })).status).toBe(201)
    expect(docker.created).toHaveLength(1)
  })
})

describe('DELETE /api/access/:id', () => {
  it('closes a bridge without touching the service', async () => {
    const { app, docker } = makeApp({ containers: [...GATEWAY, ...PROJECT_A, BRIDGE] }, fast)
    const response = await del(app, '/api/access/ab12cd')
    expect(response.status).toBe(200)
    expect(docker.removed).toEqual(['bridge-1'])
  })

  it('404s for an id that is not open', async () => {
    const { app, docker } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, fast)
    expect((await del(app, '/api/access/nothere')).status).toBe(404)
    expect(docker.removed).toEqual([])
  })
})
