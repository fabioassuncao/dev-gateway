// Applying saved settings. The panel's whole part in it is starting one
// container the host created stopped, and reading back what that container did.
// See ADR 0026.
import { describe, it, expect } from 'vitest'
import { makeApp, post, type FakeContainer } from './helpers.ts'
import { GATEWAY } from './fixtures.ts'

const APPLIER: FakeContainer = {
  id: 'gw-apply',
  name: 'portta-apply',
  image: 'fabioassuncao/portta-apply:0.1.0',
  state: 'created',
  // Created and never started: Docker writes a zero time, not an absent one.
  startedAt: '0001-01-01T00:00:00Z',
  labels: { 'portta.managed': 'true', 'portta.component': 'apply', 'traefik.enable': 'false' },
}

const RUNNING: FakeContainer = { ...APPLIER, state: 'running', startedAt: '2026-01-01T10:00:00Z' }
const FAILED: FakeContainer = {
  ...APPLIER,
  state: 'exited',
  exitCode: 2,
  startedAt: '2026-01-01T10:00:00Z',
  finishedAt: '2026-01-01T10:00:40Z',
}
const SUCCEEDED: FakeContainer = { ...FAILED, exitCode: 0 }

const status = async (containers: FakeContainer[], query = '') => {
  const { app, docker } = makeApp({ containers })
  const response = await app.request(`/api/gateway/apply${query}`)
  expect(response.status).toBe(200)
  return { body: await response.json(), docker }
}

describe('GET /api/gateway/apply', () => {
  it('says so, and how to fix it, when the host has no applier', async () => {
    const { body } = await status(GATEWAY)
    expect(body).toMatchObject({ state: 'unavailable', available: false })
    // The reason has to name the setting *and* the command: turning the key on
    // is not enough on its own, and neither is running the command.
    expect(body.reason).toContain('PORTTA_APPLY')
    expect(body.applyCommand).toContain('bin/portta up')
  })

  it('reports a prepared applier that has never run as idle', async () => {
    const { body } = await status([...GATEWAY, APPLIER])
    expect(body).toMatchObject({ state: 'idle', available: true, exitCode: null, startedAt: null })
  })

  it('reports one that is running', async () => {
    const { body } = await status([...GATEWAY, RUNNING])
    expect(body).toMatchObject({ state: 'running', exitCode: null })
    expect(body.startedAt).toBeGreaterThan(0)
  })

  it('reports a successful apply', async () => {
    const { body } = await status([...GATEWAY, SUCCEEDED])
    expect(body).toMatchObject({ state: 'ok', exitCode: 0 })
    expect(body.finishedAt).toBeGreaterThan(0)
  })

  it('reports a failed one with its exit code, and its output unasked', async () => {
    // A failure the operator cannot read is a failure they cannot act on, so
    // the log tail comes along without having to be requested.
    const { body } = await status([...GATEWAY, FAILED])
    expect(body).toMatchObject({ state: 'failed', exitCode: 2 })
    expect(Array.isArray(body.logTail)).toBe(true)
  })

  it('does not read the log on a successful apply unless asked', async () => {
    const { docker } = await status([...GATEWAY, SUCCEEDED])
    expect(docker.calls.some((call) => call.method === 'logs')).toBe(false)

    const asked = await status([...GATEWAY, SUCCEEDED], '?logs=1')
    expect(asked.docker.calls.some((call) => call.method === 'logs')).toBe(true)
  })
})

describe('POST /api/gateway/apply', () => {
  it('starts the applier, and nothing else', async () => {
    const { app, docker } = makeApp({ containers: [...GATEWAY, APPLIER] })
    const response = await post(app, '/api/gateway/apply')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true })
    expect(docker.calls).toContainEqual({ method: 'start', args: ['gw-apply'] })
    // Never a restart, never a create: the whole feature is one start.
    expect(docker.calls.some((call) => call.method === 'restart' || call.method === 'createBridge')).toBe(false)
  })

  it('refuses when the host has no applier, and hands back the host command', async () => {
    const { app, docker } = makeApp({ containers: GATEWAY })
    const response = await post(app, '/api/gateway/apply')
    expect(response.status).toBe(404)
    expect((await response.json()).hint).toContain('bin/portta up')
    expect(docker.calls.some((call) => call.method === 'start')).toBe(false)
  })

  it('refuses a second apply while one is running', async () => {
    const { app, docker } = makeApp({ containers: [...GATEWAY, RUNNING] })
    const response = await post(app, '/api/gateway/apply')
    expect(response.status).toBe(409)
    expect(docker.calls.some((call) => call.method === 'start')).toBe(false)
  })

  it('is refused in read-only mode', async () => {
    const { app, docker } = makeApp({ containers: [...GATEWAY, APPLIER] }, { readOnly: true })
    const response = await post(app, '/api/gateway/apply')
    expect(response.status).toBe(403)
    expect(docker.calls.some((call) => call.method === 'start')).toBe(false)
  })

  it('is refused cross-origin', async () => {
    const { app, docker } = makeApp({ containers: [...GATEWAY, APPLIER] })
    const response = await app.request('/api/gateway/apply', {
      method: 'POST',
      headers: { origin: 'http://evil.test', host: 'localhost', 'content-type': 'application/json' },
      body: '{}',
    })
    expect(response.status).toBe(403)
    expect(docker.calls.some((call) => call.method === 'start')).toBe(false)
  })
})

describe('the generic container routes still refuse the applier', () => {
  // The dedicated route is the only door. Without this, the applier would be
  // startable through the same endpoint that starts any container, and the
  // 409/404 guards above could be walked around.
  it('POST /api/docker/containers/:id/start is refused', async () => {
    const { app, docker } = makeApp({ containers: [...GATEWAY, APPLIER] })
    const response = await post(app, '/api/docker/containers/gw-apply/start')
    expect(response.status).toBe(403)
    expect(docker.calls.some((call) => call.method === 'start')).toBe(false)
  })
})
