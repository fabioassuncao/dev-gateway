import { mkdtempSync, readFileSync, existsSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fakeDatabase, makeApp } from './helpers.ts'
import { GATEWAY, PROJECT_A } from './fixtures.ts'
import { parseAliases, renderAliases } from '@dev-gateway/core'
import { GENERATED_FILES } from '../../src/server/core/dynamic.ts'
import type { Project } from '../../src/shared/types.ts'

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'dg-overrides-'))
}

const cleanup: string[] = []
afterEach(() => {
  for (const dir of cleanup.splice(0)) {
    try { chmodSync(dir, 0o700) } catch { /* already writable */ }
  }
})

function app(dynamicDir = scratch(), options: { available?: boolean } = {}) {
  const db = fakeDatabase(options)
  return { ...makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, { dynamicDir }, db), db, dynamicDir }
}

async function put(instance: ReturnType<typeof app>, path: string, body: unknown) {
  return instance.app.request(path, {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
  })
}

describe('the generated aliases file', () => {
  it('is the third file the panel may write, and nothing more', () => {
    expect(Object.values(GENERATED_FILES)).toEqual([
      'dev-gateway-panel.yaml',
      'dev-gateway-shares.yaml',
      'dev-gateway-aliases.yaml',
    ])
  })

  it('round-trips through its own marker line', () => {
    const aliases = [
      { project: 'alpha', service: 'web', container: 'alpha-web-1', host: 'shop.localhost', port: 80, entryPoint: 'web' },
    ]
    expect(parseAliases(renderAliases(aliases))).toEqual(aliases)
  })

  it('says so plainly when nothing is aliased', () => {
    expect(renderAliases([])).toContain('No alias is set')
    expect(renderAliases([])).not.toContain('routers:')
  })
})

describe('project overrides', () => {
  it('stores presentation without writing anything about routing', async () => {
    const instance = app()
    const response = await put(instance, '/api/projects/alpha/settings', {
      displayName: 'Awesome Thing',
      pinned: true,
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ displayName: 'Awesome Thing', pinned: true })
    expect(existsSync(join(instance.dynamicDir, GENERATED_FILES.aliases))).toBe(false)
  })

  it('shows the override beside the derived name rather than instead of it', async () => {
    const instance = app()
    await put(instance, '/api/projects/alpha/settings', { displayName: 'Awesome Thing' })

    const project = (await (await instance.app.request('/api/projects/alpha')).json()) as Project
    expect(project.name).toBe('alpha')
    expect(project.overrides?.displayName).toBe('Awesome Thing')
  })

  it('clears a value when it is sent as null', async () => {
    const instance = app()
    await put(instance, '/api/projects/alpha/settings', { description: 'temporary' })
    const response = await put(instance, '/api/projects/alpha/settings', { description: null })
    expect(await response.json()).toEqual({})
  })

  it('refuses a key outside the closed catalogue', async () => {
    const instance = app()
    const response = await put(instance, '/api/projects/alpha/settings', { arbitrarySql: 'DROP' })
    expect(response.status).toBe(500)
  })

  it('404s a project that is not running before touching the database', async () => {
    const instance = app()
    const response = await put(instance, '/api/projects/ghost/settings', { pinned: true })
    expect(response.status).toBe(404)
    expect(instance.db.projectValues.size).toBe(0)
  })

  it('answers 503 with a hint when persistence is down', async () => {
    const instance = app(scratch(), { available: false })
    const response = await instance.app.request('/api/projects/alpha/settings')
    expect(response.status).toBe(503)
    expect((await response.json()).hint).toContain('Docker-backed pages remain available')
  })

  it('leaves every project rendering exactly as before with no database', async () => {
    const withDatabase = makeApp({ containers: [...GATEWAY, ...PROJECT_A] })
    const body = await (await withDatabase.app.request('/api/projects')).json()
    expect(JSON.stringify(body)).not.toContain('overrides')
  })
})

describe('a hostname alias', () => {
  it('is served by Traefik through one generated file', async () => {
    const instance = app()
    const response = await put(instance, '/api/projects/alpha/services/web/alias', { alias: 'shop' })
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.host).toBe('shop.localhost')
    // Additive: the project's own hostname is still in the answer.
    expect(body.derivedHosts).toContain('alpha-web.localhost')

    const written = readFileSync(join(instance.dynamicDir, GENERATED_FILES.aliases), 'utf8')
    expect(written).toContain('Host(`shop.localhost`)')
    expect(written).toContain('http://alpha-web-1:80')
  })

  it('targets the container name, never the Compose service alias', async () => {
    const instance = app()
    await put(instance, '/api/projects/alpha/services/api/alias', { alias: 'shop-api' })
    const written = readFileSync(join(instance.dynamicDir, GENERATED_FILES.aliases), 'utf8')
    expect(written).toContain('http://alpha-api-1:3000')
  })

  it('refuses a hostname a running container already claims', async () => {
    const instance = app()
    const response = await put(instance, '/api/projects/alpha/services/web/alias', {
      alias: 'alpha-web.localhost',
    })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('already the hostname')
    expect(existsSync(join(instance.dynamicDir, GENERATED_FILES.aliases))).toBe(false)
  })

  it('refuses a hostname another alias already took', async () => {
    const instance = app()
    await put(instance, '/api/projects/alpha/services/web/alias', { alias: 'shop' })
    const response = await put(instance, '/api/projects/alpha/services/api/alias', { alias: 'shop' })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('already an alias')
  })

  it('refuses a hostname outside the domains this gateway serves', async () => {
    const instance = app()
    const response = await put(instance, '/api/projects/alpha/services/web/alias', {
      alias: 'shop.example.com',
    })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('outside the domains')
  })

  it('refuses a datastore, which is not reached with an HTTP router', async () => {
    const instance = app()
    const response = await put(instance, '/api/projects/alpha/services/postgres/alias', { alias: 'db' })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('postgres service')
  })

  it('refuses a service the gateway does not route', async () => {
    const instance = app()
    const response = await put(instance, '/api/projects/alpha/services/redis/alias', { alias: 'cache' })
    expect(response.status).toBe(400)
    expect(existsSync(join(instance.dynamicDir, GENERATED_FILES.aliases))).toBe(false)
  })

  it('refuses a value YAML quoting would not accept', async () => {
    const instance = app()
    const response = await put(instance, '/api/projects/alpha/services/web/alias', { alias: 'sh"op' })
    expect(response.status).toBe(400)
  })

  it('rolls the row back when the file cannot be written', async () => {
    const instance = app('/proc/dev-gateway-cannot-write')
    const response = await put(instance, '/api/projects/alpha/services/web/alias', { alias: 'shop' })
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(instance.db.serviceValues.get('web:alias')).toBeUndefined()
  })

  it('removes its router from the generated file when cleared', async () => {
    const instance = app()
    await put(instance, '/api/projects/alpha/services/web/alias', { alias: 'shop' })

    const response = await instance.app.request('/api/projects/alpha/services/web/alias', {
      method: 'DELETE',
      body: '{}',
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
    })
    expect(response.status).toBe(200)
    expect((await response.json()).removed).toBe('shop.localhost')

    const written = readFileSync(join(instance.dynamicDir, GENERATED_FILES.aliases), 'utf8')
    expect(written).not.toContain('shop.localhost')
    expect(instance.db.serviceValues.get('web:alias')).toBeUndefined()
  })

  it('shows the alias on the service without touching its derived URLs', async () => {
    const instance = app()
    await put(instance, '/api/projects/alpha/services/web/alias', { alias: 'shop' })

    const project = (await (await instance.app.request('/api/projects/alpha')).json()) as Project
    const web = project.services.find((service) => service.service === 'web')!
    expect(web.overrides?.alias).toBe('shop.localhost')
    expect(web.urls.map((url) => url.host)).toContain('alpha-web.localhost')
  })

  it('reports an alias whose container is gone', async () => {
    const instance = app()
    await put(instance, '/api/projects/alpha/services/web/alias', { alias: 'shop' })

    // The environment came back under a different namespace: the router now
    // points at a container name nothing answers to.
    const moved = makeApp(
      { containers: [...GATEWAY] },
      { dynamicDir: instance.dynamicDir },
      instance.db,
    )
    const doctor = await moved.app.request('/api/gateway/doctor', {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
    })
    const checks = (await doctor.json()).checks as { id: string; detail?: string; message?: string }[]
    expect(checks.some((check) => check.id === 'aliases-dangling')).toBe(true)
  })
})
