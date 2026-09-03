import { describe, expect, it } from 'vitest'
import { API_CAPABILITIES, DEFAULT_AGENT_CAPABILITIES, READ_CAPABILITIES, hasApiCapability, parseApiCapabilities } from './capabilities-api.js'

describe('api capabilities', () => {
  it('read-only mode holds every read and no write', () => {
    expect(READ_CAPABILITIES.every((c) => c.endsWith(':read'))).toBe(true)
    expect(READ_CAPABILITIES).toContain('project:read')
    expect(READ_CAPABILITIES).not.toContain('task:write')
  })
  it('an agent may work but not destroy or reconfigure', () => {
    expect(DEFAULT_AGENT_CAPABILITIES).toContain('task:write')
    expect(DEFAULT_AGENT_CAPABILITIES).toContain('environment:operate')
    expect(DEFAULT_AGENT_CAPABILITIES).not.toContain('environment:destroy')
    expect(DEFAULT_AGENT_CAPABILITIES).not.toContain('config:write')
    expect(DEFAULT_AGENT_CAPABILITIES).not.toContain('access:write')
  })
  it('coerces a stored list and drops what it does not know', () => {
    expect(parseApiCapabilities(['task:read', 'nope', 'task:read', 3])).toEqual(['task:read'])
    expect(parseApiCapabilities('task:read')).toEqual([])
  })
  it('checks membership on a set or a list', () => {
    expect(hasApiCapability(new Set(['logs:read']), 'logs:read')).toBe(true)
    expect(hasApiCapability(['logs:read'], 'task:write')).toBe(false)
    expect(API_CAPABILITIES.length).toBeGreaterThan(20)
  })
})
