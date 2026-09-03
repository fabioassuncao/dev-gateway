import { afterEach, describe, expect, it, vi } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { Command } from 'commander'

const mocks = vi.hoisted(() => ({ requests: [] as { method: string; url: string; body: unknown }[] }))
vi.mock('../context.js', () => ({
  gatewayContext: () => ({ root: '/tmp/portta', env: { PORTTA_WEB_PORT: '8081', PORTTA_WEB_AUTH_USER: 'dev', PORTTA_PANEL_PASSWORD: 'secret' }, config: {}, composeFiles: [], version: 'test' }),
}))

import { examplesApply, findExampleManifests, tasksImport } from './examples.js'

function command(globals: Record<string, unknown> = {}): Command {
  return { optsWithGlobals: () => ({ json: true, ...globals }) } as unknown as Command
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const shopManifest = join(repoRoot, 'docker/examples/demo-shop/portta.example.json')

afterEach(() => { vi.restoreAllMocks(); mocks.requests.length = 0 })

function stubPanel() {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const method = init.method ?? 'GET'
    mocks.requests.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : undefined })
    if (method === 'GET' && /\/projects\/[^/]+$/.test(url)) {
      return new Response('', { status: 404 })
    }
    if (method === 'POST' && url.endsWith('/projects')) {
      return new Response(JSON.stringify({ slug: 'demo-shop' }), { status: 201, headers: { 'content-type': 'application/json' } })
    }
    if (method === 'POST' && url.includes('/tasks/import')) {
      return new Response(JSON.stringify({ created: 2, updated: 0 }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  })
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
}

describe('portta examples', () => {
  it('finds every portta.example.json under docker/examples', () => {
    const found = findExampleManifests(repoRoot)
    expect(found.some((path) => path.endsWith('demo-shop/portta.example.json'))).toBe(true)
    expect(found.some((path) => path.endsWith('demo-monorepo/portta.example.json'))).toBe(true)
    expect(found.some((path) => path.endsWith('demo-a/portta.example.json'))).toBe(true)
  })

  it('creates the project when it is missing, then posts the document', async () => {
    stubPanel()
    await examplesApply({ file: shopManifest }, command())
    expect(mocks.requests[0]).toMatchObject({ method: 'GET', url: 'http://127.0.0.1:8081/api/projects/demo-shop' })
    expect(mocks.requests[1]).toMatchObject({ method: 'POST', url: 'http://127.0.0.1:8081/api/projects', body: { slug: 'demo-shop', name: 'Demo Shop' } })
    expect(mocks.requests[2]).toMatchObject({ method: 'POST', url: 'http://127.0.0.1:8081/api/projects/demo-shop/tasks/import' })
    expect(mocks.requests[2]!.body).toMatchObject({ schemaVersion: 1, project: { slug: 'demo-shop' } })
  })

  it('imports one file into a named project', async () => {
    stubPanel()
    await tasksImport({ project: 'produto', file: shopManifest }, command())
    expect(mocks.requests[0]).toMatchObject({ method: 'POST', url: 'http://127.0.0.1:8081/api/projects/produto/tasks/import' })
  })

  it('requires --file and --project for tasks import', async () => {
    stubPanel()
    await expect(tasksImport({ file: shopManifest }, command())).rejects.toThrow(/--project/)
    await expect(tasksImport({ project: 'produto' }, command())).rejects.toThrow(/--file/)
  })
})
