import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Command } from 'commander'

const mocks = vi.hoisted(() => ({ requests: [] as { method: string; url: string; body: unknown; headers: Record<string, string> }[], answer: {} as unknown, status: 200 }))
vi.mock('../context.js', () => ({
  gatewayContext: () => ({ root: '/tmp/portta', env: { PORTTA_WEB_PORT: '8081', PORTTA_WEB_AUTH_USER: 'dev', PORTTA_PANEL_PASSWORD: 'secret' }, config: {}, composeFiles: [], version: 'test' }),
}))

import { tasksCreate, tasksList, tasksNext, tasksStart, tasksSync } from './tasks.js'
import { sessionsEnd, sessionsStart } from './sessions.js'
import { activityCommand } from './activity.js'

function command(globals: Record<string, unknown> = {}): Command {
  return { optsWithGlobals: () => ({ json: true, ...globals }) } as unknown as Command
}

let stdout = ''
afterEach(() => { vi.restoreAllMocks(); mocks.requests.length = 0; mocks.status = 200; stdout = '' })

function stubFetch(answer: unknown, status = 200) {
  mocks.answer = answer
  mocks.status = status
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    mocks.requests.push({ method: init.method ?? 'GET', url, body: init.body ? JSON.parse(String(init.body)) : undefined, headers: init.headers as Record<string, string> })
    return new Response(JSON.stringify(mocks.answer), { status: mocks.status, headers: { 'content-type': 'application/json' } })
  })
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { stdout += String(chunk); return true })
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
}

describe('portta tasks', () => {
  it('lists a project’s tasks through the panel, with the credential and the actor', async () => {
    stubFetch({ tasks: [{ id: '1', title: 't', status: 'ready', subtaskCount: 0, openSubtaskCount: 0, github: null, repository: null, updatedAt: 1 }] })
    await tasksList({ project: 'shop', status: 'ready,blocked', open: true }, command({ actor: 'claude-code' }))
    expect(mocks.requests[0]).toMatchObject({ method: 'GET', url: 'http://127.0.0.1:8081/api/projects/shop/tasks?status=ready%2Cblocked&open=true' })
    expect(mocks.requests[0]!.headers['X-Portta-Actor']).toBe('claude-code')
    expect(mocks.requests[0]!.headers['authorization']).toMatch(/^Basic /)
    expect(JSON.parse(stdout).tasks).toHaveLength(1)
  })

  it('requires a project for list and next', async () => {
    stubFetch({ tasks: [] })
    await expect(tasksList({}, command())).rejects.toThrow(/--project/)
    await expect(tasksNext({}, command())).rejects.toThrow(/--project/)
  })

  it('creates and starts a task, and carries the panel’s refusal as words', async () => {
    stubFetch({ id: '7', title: 'x', status: 'backlog', notes: [], environments: [], subtasks: [], activeSessionCount: 0, github: null, repository: null, panelUrl: '#' })
    await tasksCreate({ project: 'shop', title: 'x', priority: 'high', labels: 'a, b', parent: '#3' }, command())
    expect(mocks.requests[0]).toMatchObject({ method: 'POST', body: { title: 'x', priority: 'high', labels: ['a', 'b'], parentId: '3' } })
    await tasksStart('acme/api#42', { noAssign: true }, command())
    expect(mocks.requests[1]).toMatchObject({ url: 'http://127.0.0.1:8081/api/tasks/acme%2Fapi%2342/start', body: { assign: false } })

    stubFetch({ error: 'the task and its issue both changed; pass resolve: local or remote' }, 409)
    await expect(tasksSync('7', {}, command())).rejects.toThrow(/the panel answered 409: the task and its issue both changed/)
    await expect(tasksSync('7', { resolve: 'sideways' }, command())).rejects.toThrow(/--resolve/)
  })

  it('refuses a non-loopback panel without --allow-remote', async () => {
    stubFetch({})
    await expect(tasksList({ project: 'shop' }, command({ url: 'https://panel.example.com' }))).rejects.toThrow(/refusing to send a panel credential/)
    expect(mocks.requests).toEqual([])
  })
})

describe('portta sessions and activity', () => {
  it('starts and ends a session', async () => {
    stubFetch({ id: '9', actor: 'claude-code', status: 'active', commits: [] })
    await sessionsStart({ project: 'shop', task: '#7', environment: 'shop', summary: 'auth' }, command())
    expect(mocks.requests[0]).toMatchObject({ method: 'POST', url: 'http://127.0.0.1:8081/api/projects/shop/sessions', body: { taskId: '7', environment: 'shop', summary: 'auth' } })
    stubFetch({ id: '9', actor: 'claude-code', status: 'ended', commits: [{ sha: 'a' }] })
    await sessionsEnd('9', { summary: 'done' }, command())
    expect(mocks.requests[1]).toMatchObject({ method: 'PATCH', url: 'http://127.0.0.1:8081/api/sessions/9', body: { status: 'ended', summary: 'done' } })
  })

  it('reads activity for a project or for the node', async () => {
    stubFetch({ events: [] })
    await activityCommand({ project: 'shop', kind: 'task.status', limit: '5' }, command())
    expect(mocks.requests[0]!.url).toBe('http://127.0.0.1:8081/api/projects/shop/activity?kind=task.status&limit=5')
    await activityCommand({}, command())
    expect(mocks.requests[1]!.url).toBe('http://127.0.0.1:8081/api/activity')
  })
})
