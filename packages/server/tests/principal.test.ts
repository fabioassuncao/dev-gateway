// Who is asking, and what they may do.

import { describe, expect, it } from 'vitest'
import { DEFAULT_AGENT_CAPABILITIES } from 'portta-core'
import { principalFor } from '../src/api/principal.ts'
import { GATEWAY, PROJECT_A } from './fixtures.ts'
import { fakeDatabase, makeApp, post } from './helpers.ts'

const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name] ?? values[name.toLowerCase()] ?? null })
const source = (readOnly = false, granted = DEFAULT_AGENT_CAPABILITIES) => ({ readOnly, agentCapabilities: async () => granted })

describe('the principal', () => {
  it('is the operator with everything when nobody says otherwise', async () => {
    const principal = await principalFor(headers({}), source())
    expect(principal).toMatchObject({ kind: 'operator', actor: null, actorKind: 'human' })
    expect(principal.capabilities.has('environment:destroy')).toBe(true)
  })

  it('holds every read and no write in read-only mode', async () => {
    const principal = await principalFor(headers({}), source(true))
    expect(principal.capabilities.has('task:read')).toBe(true)
    expect(principal.capabilities.has('task:write')).toBe(false)
  })

  it('makes an announced actor an agent with the granted set', async () => {
    const principal = await principalFor(headers({ 'X-Portta-Actor': 'claude-code' }), source())
    expect(principal).toMatchObject({ kind: 'agent', actor: 'claude-code', actorKind: 'agent' })
    expect(principal.capabilities.has('task:write')).toBe(true)
    expect(principal.capabilities.has('environment:destroy')).toBe(false)
    expect(principal.capabilities.has('config:write')).toBe(false)
  })

  it('lets a person announce themselves for attribution without losing anything', async () => {
    const principal = await principalFor(headers({ 'X-Portta-Actor': 'fabio', 'X-Portta-Actor-Kind': 'human' }), source())
    expect(principal).toMatchObject({ kind: 'operator', actor: 'fabio', actorKind: 'human' })
    expect(principal.capabilities.has('environment:destroy')).toBe(true)
  })

  it('uses the actor and exact capabilities authenticated by a bearer token', async () => {
    const principal = await principalFor(headers({
      'X-Portta-Token-Authenticated': 'true',
      'X-Portta-Actor': 'release-bot',
      'X-Portta-Actor-Kind': 'human',
      'X-Portta-Capabilities': 'task:read,task:write',
      'X-Portta-Source': 'cli',
    }), source())
    expect(principal).toMatchObject({ kind: 'agent', actor: 'release-bot', actorKind: 'human', source: 'cli' })
    expect([...principal.capabilities]).toEqual(['task:read', 'task:write'])
    expect(principal.capabilities.has('environment:destroy')).toBe(false)
  })

  it('narrows an agent further in read-only mode, and falls back to the default set when the setting cannot be read', async () => {
    const narrowed = await principalFor(headers({ 'X-Portta-Actor': 'bot' }), source(true))
    expect(narrowed.capabilities.has('task:write')).toBe(false)
    const fallback = await principalFor(headers({ 'X-Portta-Actor': 'bot' }), { readOnly: false, agentCapabilities: async () => { throw new Error('db down') } })
    expect(fallback.capabilities.has('task:write')).toBe(true)
  })
})

describe('capabilities on the routes', () => {
  it('refuses an agent a destructive operation it does not hold, with the capability named', async () => {
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, {}, fakeDatabase())
    const response = await post(app, '/api/environments/alpha/operations/remove', { confirmation: 'alpha', volumes: false, directory: false }, { 'X-Portta-Actor': 'claude-code' })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('environment:destroy') })
  })

  it('lets the same agent operate what it holds', async () => {
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, {}, fakeDatabase())
    const response = await post(app, '/api/environments/alpha/actions/stop', {}, { 'X-Portta-Actor': 'claude-code' })
    expect(response.status).toBe(200)
  })

  it('lets the operator do everything', async () => {
    const { app } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, {}, fakeDatabase())
    const response = await app.request('/api/environments/alpha/removal-preview')
    expect(response.status).toBe(200)
  })

  it('publishes the capability of every operation in the contract', async () => {
    const { app } = makeApp({ containers: GATEWAY })
    const spec = (await (await app.request('/api/openapi.json')).json()) as { paths: Record<string, Record<string, { 'x-portta-capability'?: string }>> }
    const operations = Object.values(spec.paths).flatMap((path) => Object.values(path))
    expect(operations.length).toBeGreaterThan(80)
    for (const operation of operations) expect(operation['x-portta-capability']).toMatch(/^[a-z]+:[a-z]+$/)
    expect(spec.paths['/environments/{project}/operations/remove']!['post']!['x-portta-capability']).toBe('environment:destroy')
  })
})
