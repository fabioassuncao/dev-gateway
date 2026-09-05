import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { principal, renderWithQuery } from './render.tsx'

class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const config = vi.fn()
const patchConfig = vi.fn()
const agentPermissions = vi.fn()
const setAgentPermissions = vi.fn()
const github = vi.fn()

vi.mock('@/lib/api', () => ({
  ApiError,
  api: {
    config: () => config(),
    patchConfig: (...args: unknown[]) => patchConfig(...args),
    agentPermissions: () => agentPermissions(),
    setAgentPermissions: (...args: unknown[]) => setAgentPermissions(...args),
    github: () => github(),
  },
}))

const { GeneralView } = await import('../../app/(panel)/settings/general/[[...group]]/general-view.tsx')
const { AgentPermissionsCard } = await import('../../components/settings/agent-permissions-card.tsx')

function field(overrides: Record<string, unknown> = {}) {
  return {
    key: 'PORTTA_PANEL_PORT',
    value: '9912',
    runtimeValue: '9912',
    secret: false,
    isSet: true,
    pending: false,
    kind: 'string',
    group: 'Panel',
    label: 'Panel port',
    help: 'Where the panel listens.',
    restartRequired: true,
    ...overrides,
  }
}

beforeEach(() => {
  config.mockReset().mockResolvedValue({
    fields: [field(), field({ key: 'GITHUB_TOKEN', group: 'GitHub', secret: true, value: null })],
    projectDomain: { mode: 'local', domain: 'localhost', publicIp: null, provider: 'none', examples: [], problem: null, reachable: true, advice: null },
    envFile: { path: '/srv/portta/.env', exists: true, writable: true },
    pendingRestart: false,
    applyCommand: 'portta apply',
    groups: ['Panel', 'GitHub'],
  })
  patchConfig.mockReset().mockResolvedValue({ ok: true, saved: [], pendingRestart: false, applyCommand: 'portta apply', view: null })
  agentPermissions.mockReset().mockResolvedValue({
    permissions: ['task:read', 'task:write'],
    defaults: ['task:read', 'task:write'],
    available: ['task:read', 'task:write', 'task:delete', 'settings:read'],
    configured: false,
  })
  setAgentPermissions.mockReset().mockResolvedValue({
    permissions: ['task:read'],
    defaults: ['task:read', 'task:write'],
    available: ['task:read', 'task:write', 'task:delete', 'settings:read'],
    configured: true,
  })
})

describe('the General settings', () => {
  it('leaves GitHub to its own section', async () => {
    renderWithQuery(<GeneralView group="panel" />, undefined, principal())
    expect(await screen.findByRole('link', { name: 'Panel' })).toHaveAttribute('href', '/settings/general/panel')
    expect(screen.queryByRole('link', { name: 'GitHub' })).toBeNull()
  })

  it('hides Save from somebody who may only read the settings', async () => {
    const readOnly = principal({ permissions: ['settings:read'] })
    renderWithQuery(<GeneralView group="panel" />, undefined, readOnly)
    await screen.findByRole('link', { name: 'Panel' })
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })
})

describe('what a local agent may do', () => {
  it('says the default is in force until somebody narrows it', async () => {
    renderWithQuery(<AgentPermissionsCard editable />, undefined, principal())
    expect(await screen.findByText('Using the default')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'task:write' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'task:delete' })).not.toBeChecked()
  })

  it('saves the list somebody ticked, and never a name the panel does not know', async () => {
    renderWithQuery(<AgentPermissionsCard editable />, undefined, principal())
    await screen.findByText('Using the default')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await userEvent.click(screen.getByRole('checkbox', { name: 'task:write' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(setAgentPermissions).toHaveBeenCalledWith(['task:read'])
    expect(await screen.findByRole('button', { name: 'Restore the default' })).toBeInTheDocument()
  })

  it('is inert for somebody who may only read', async () => {
    renderWithQuery(<AgentPermissionsCard editable={false} />, undefined, principal())
    await screen.findByRole('checkbox', { name: 'task:read' })
    expect(screen.getByRole('checkbox', { name: 'task:read' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })
})
