import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Command } from 'commander'

const mocks = vi.hoisted(() => ({ requests: [] as { method: string; url: string }[], answer: {} as unknown }))
vi.mock('../context.js', () => ({
  gatewayContext: () => ({ root: '/tmp/portta', env: { PORTTA_WEB_PORT: '8081' }, config: {}, composeFiles: [], version: 'test' }),
}))

import { envLogs, overviewCommand, projectsContext, projectsCreate, projectsList, projectsShow } from './products.js'

function command(globals: Record<string, unknown> = {}): Command {
  return { optsWithGlobals: () => ({ json: true, ...globals }) } as unknown as Command
}
let stdout = ''
afterEach(() => { vi.restoreAllMocks(); mocks.requests.length = 0; stdout = '' })
function stubFetch(answer: unknown) {
  mocks.requests.length = 0
  mocks.answer = answer
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    mocks.requests.push({ method: init.method ?? 'GET', url })
    return new Response(JSON.stringify(mocks.answer), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { stdout += String(chunk); return true })
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
}

describe('portta projects', () => {
  it('lists and shows products through the panel', async () => {
    stubFetch({ projects: [{ slug: 'shop', name: 'Shop', repositoryCount: 1, environmentCount: 1, runningEnvironmentCount: 1, location: 'managed' }] })
    await projectsList({}, command())
    expect(mocks.requests[0]).toMatchObject({ method: 'GET', url: 'http://127.0.0.1:8081/api/projects' })
    expect(JSON.parse(stdout).projects[0].slug).toBe('shop')
    stubFetch({ slug: 'shop', name: 'Shop', repositories: [], environments: [] })
    await projectsShow('shop', command())
    expect(mocks.requests[0]!.url).toBe('http://127.0.0.1:8081/api/projects/shop')
  })

  it('derives a slug on create and asks for the context of a task', async () => {
    stubFetch({ slug: 'my-shop', name: 'My Shop' })
    await projectsCreate({ name: 'My Shop' }, command())
    expect(mocks.requests[0]).toMatchObject({ method: 'POST' })
    stubFetch({ project: { name: 'Shop', slug: 'shop', path: null }, work: { inProgress: [], next: null }, repositories: [], environments: [], instructions: { task: null } })
    await projectsContext('shop', { task: '42' }, command())
    expect(mocks.requests[0]!.url).toBe('http://127.0.0.1:8081/api/projects/shop/context?task=42')
  })

  it('reads the dashboard and an environment’s logs', async () => {
    stubFetch({ work: { counts: { open: 1, inProgress: 1, review: 0, blocked: 0 } }, sessions: [], attention: [], projects: [] })
    await overviewCommand({}, command())
    expect(mocks.requests[0]!.url).toBe('http://127.0.0.1:8081/api/overview')
    stubFetch({ lines: [] })
    await envLogs('alpha', { service: 'api', tail: '50' }, command())
    expect(mocks.requests[0]!.url).toBe('http://127.0.0.1:8081/api/environments/alpha/logs?service=api&tail=50')
  })
})
