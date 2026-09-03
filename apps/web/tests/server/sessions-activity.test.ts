// Sessions and activity: who is working on what, and what happened.

import { describe, expect, it } from 'vitest'
import type { Database } from '../../src/server/db/index.ts'
import { GATEWAY, PROJECT_A } from './fixtures.ts'
import { makeApp, post } from './helpers.ts'
import { fakeActivity, fakeSessions, fakeTasks, type FakeActivity, type FakeSessions, type FakeTasks } from './fake-work.ts'

function work(): { db: Database; tasks: FakeTasks; sessions: FakeSessions; activity: FakeActivity } {
  const tasks = fakeTasks()
  const sessions = fakeSessions()
  const activity = fakeActivity()
  const db = {
    status: () => ({ configured: true, available: true, reason: null, checkedAt: 0, migrations: [] }),
    environments: { find: async (name: string) => (name === 'alpha' ? { id: 'e1', composeProject: 'alpha' } : null), upsertSeen: async () => ({}), list: async () => [{ id: 'e1', composeProject: 'alpha' }] },
    settings: { listAllEnvironment: async () => [], listAllService: async () => [], getGlobal: async () => null },
    repositories: { list: async () => [{ id: '10', projectId: 'w1', name: 'api', githubRepositoryId: null, github: null }], find: async () => null, findByGitHub: async () => null },
    projects: {
      find: async (slug: string) => (slug === 'produto' ? { id: 'w1', slug, name: 'Produto' } : null),
      list: async () => [{ id: 'w1', slug: 'produto', name: 'Produto' }],
      listEnvironments: async () => [{ projectId: 'w1', composeProject: 'alpha', source: 'manual' }],
    },
    github: { listIssues: async () => [], findIssue: async () => null, listRelationships: async () => [], findRepository: async () => null, listRepositories: async () => [] },
    tasks, sessions, activity,
  } as unknown as Database
  return { db, tasks, sessions, activity }
}

const json = (response: Response) => response.json() as Promise<Record<string, any>>

describe('sessions', () => {
  it('starts, heartbeats and ends a session, as the agent that announced itself', async () => {
    const { db, tasks, activity } = work()
    const task = tasks.seed({ projectId: 'w1', title: 'Fix auth' })
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, {}, db)
    const started = await post(app, '/api/projects/produto/sessions', { taskId: task.id, environment: 'alpha', summary: 'auth fix' }, { 'X-Portta-Actor': 'claude-code' })
    expect(started.status).toBe(201)
    const session = await json(started)
    expect(session).toMatchObject({ actor: 'claude-code', actorKind: 'agent', agent: 'claude-code', status: 'active', task: { id: task.id, title: 'Fix auth' }, environment: 'alpha', project: 'produto' })
    expect(activity.rows[0]).toMatchObject({ kind: 'session.started', sessionId: session.id, taskId: task.id })
    expect((await json(await app.request(`/api/tasks/${task.id}`))).activeSessionCount).toBe(1)

    const beat = await app.request(`/api/sessions/${session.id}`, { method: 'PATCH', body: JSON.stringify({ heartbeat: true }), headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost', 'X-Portta-Actor': 'claude-code' } })
    expect((await json(beat)).status).toBe('active')

    const denied = await app.request(`/api/sessions/${session.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'ended' }), headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost', 'X-Portta-Actor': 'other-bot' } })
    expect(denied.status).toBe(403)

    const ended = await app.request(`/api/sessions/${session.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'ended', summary: 'done' }), headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' } })
    expect(await json(ended)).toMatchObject({ status: 'ended', summary: 'done' })
    expect(ended.status).toBe(200)
    expect(activity.rows[0]).toMatchObject({ kind: 'session.ended', sessionId: session.id })
    expect((await json(await app.request('/api/projects/produto/sessions?active=true'))).sessions).toEqual([])
    expect((await json(await app.request('/api/projects/produto/sessions'))).sessions).toHaveLength(1)
  })

  it('refuses a task from another Project and an environment the panel does not know', async () => {
    const { db, tasks } = work()
    const foreign = tasks.seed({ projectId: 'w2', title: 'Elsewhere' })
    const { app } = makeApp({ containers: GATEWAY }, {}, db)
    expect((await post(app, '/api/projects/produto/sessions', { taskId: foreign.id })).status).toBe(400)
    expect((await post(app, '/api/projects/produto/sessions', { environment: 'ghost' })).status).toBe(400)
  })
})

describe('activity', () => {
  it('lists a Project’s events newest first, with names resolved and filters applied', async () => {
    const { db, tasks, activity } = work()
    const task = tasks.seed({ projectId: 'w1', title: 'Fix auth' })
    await activity.append({ kind: 'task.created', projectId: 'w1', taskId: task.id, repositoryId: '10', summary: 'created' })
    await activity.append({ kind: 'environment.started', projectId: 'w1', environmentId: 'e1', summary: 'alpha started', actorKind: 'human', actor: 'fabio' })
    await activity.append({ kind: 'task.status', projectId: 'w2', summary: 'elsewhere' })
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, {}, db)
    const events = (await json(await app.request('/api/projects/produto/activity'))).events
    expect(events.map((event: { kind: string }) => event.kind)).toEqual(['environment.started', 'task.created'])
    expect(events[0]).toMatchObject({ project: 'produto', environment: 'alpha', actor: 'fabio' })
    expect(events[1]).toMatchObject({ taskTitle: 'Fix auth', repositoryName: 'api' })
    expect((await json(await app.request('/api/projects/produto/activity?kind=task.created'))).events).toHaveLength(1)
    expect((await json(await app.request('/api/activity'))).events).toHaveLength(3)
  })

  it('records lifecycle operations on an environment, attributed to the Project that adopted it', async () => {
    const { db, activity } = work()
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, {}, db)
    expect((await post(app, '/api/environments/alpha/actions/stop', {}, { 'X-Portta-Actor': 'claude-code' })).status).toBe(200)
    expect(activity.rows[0]).toMatchObject({ kind: 'environment.stopped', actor: 'claude-code', actorKind: 'agent', projectId: 'w1', environmentId: 'e1' })
  })
})
