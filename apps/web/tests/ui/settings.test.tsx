import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { renderWithQuery } from './render.tsx'
import type { ConfigView } from '../../src/shared/types.ts'

const config = vi.fn()
const patchConfig = vi.fn()

vi.mock('../../src/ui/lib/api.ts', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    config: () => config(),
    patchConfig: (...args: unknown[]) => patchConfig(...args),
  },
}))

const { Settings } = await import('../../src/ui/pages/Settings.tsx')

const view: ConfigView = {
  applyCommand: './bin/portta up local',
  pendingRestart: false,
  groups: ['Gateway', 'TLS', 'VPN'],
  envFile: { path: '/app/state/.env', exists: true, writable: true },
  fields: [
    {
      key: 'PORTTA_DOMAIN',
      value: 'localhost',
      runtimeValue: 'localhost',
      secret: false,
      isSet: true,
      pending: false,
      kind: 'string',
      group: 'Gateway',
      label: 'Local domain',
      help: 'Base domain for generated hostnames.',
      restartRequired: true,
    },
    {
      key: 'TLS_ENABLED',
      value: 'false',
      runtimeValue: 'false',
      secret: false,
      isSet: true,
      pending: false,
      kind: 'boolean',
      group: 'TLS',
      label: 'HTTPS',
      help: 'Master switch.',
      restartRequired: true,
    },
    {
      key: 'TS_AUTHKEY',
      value: null,
      runtimeValue: null,
      secret: true,
      isSet: true,
      pending: false,
      kind: 'string',
      group: 'VPN',
      label: 'Tailscale auth key',
      help: 'Never leaves the host.',
      restartRequired: true,
    },
  ],
}

beforeEach(() => {
  window.location.hash = ''
  document.title = 'Portta'
  config.mockReset().mockResolvedValue(view)
  patchConfig.mockReset().mockResolvedValue({ ok: true, saved: [], pendingRestart: true, applyCommand: view.applyCommand, view })
})

describe('Settings', () => {
  it('never shows a secret, only whether it is set', async () => {
    renderWithQuery(<Settings group="vpn" />)
    await screen.findByLabelText('Tailscale auth key')

    const input = screen.getByLabelText('Tailscale auth key') as HTMLInputElement
    expect(input.type).toBe('password')
    expect(input.value).toBe('')
    expect(input.placeholder).toContain('unchanged')
    expect(screen.getByText('set')).toBeInTheDocument()
  })

  it('sends only what was edited', async () => {
    renderWithQuery(<Settings group="gateway" />)
    const domain = await screen.findByLabelText('Local domain')

    await userEvent.clear(domain)
    await userEvent.type(domain, 'dev.test')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(patchConfig).toHaveBeenCalledWith({ PORTTA_DOMAIN: 'dev.test' }))
  })

  it('will not save when nothing changed', async () => {
    renderWithQuery(<Settings group="gateway" />)
    await screen.findByLabelText('Local domain')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('clears a secret only on an explicit request', async () => {
    renderWithQuery(<Settings group="vpn" />)
    await screen.findByLabelText('Tailscale auth key')

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(patchConfig).toHaveBeenCalledWith({ TS_AUTHKEY: null }))
  })

  it('says what to run on the host after saving', async () => {
    config.mockResolvedValue({ ...view, pendingRestart: true })
    renderWithQuery(<Settings group="gateway" />)
    expect(await screen.findByText('./bin/portta up local')).toBeInTheDocument()
    expect(screen.getByText(/take effect once the gateway containers are recreated/)).toBeInTheDocument()
  })

  it('shows the validation error and does not pretend it saved', async () => {
    patchConfig.mockRejectedValue(
      Object.assign(new Error('PORTTA_HTTP_PORT: must be a port between 1 and 65535'), {
        hint: 'the value was not saved',
      }),
    )
    renderWithQuery(<Settings group="gateway" />)
    const domain = await screen.findByLabelText('Local domain')
    await userEvent.type(domain, 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(/must be a port between 1 and 65535/)).toBeInTheDocument()
    expect(screen.getByText('the value was not saved')).toBeInTheDocument()
  })

  it('says so when it cannot write the file, rather than failing on save', async () => {
    config.mockResolvedValue({
      ...view,
      envFile: { path: '/app/state/.env', exists: true, writable: false },
    })
    renderWithQuery(<Settings group="gateway" />)
    expect(await screen.findByText(/cannot write/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('renders only the selected group and gives it a contextual title', async () => {
    renderWithQuery(<Settings group="tls" />)

    expect(await screen.findByLabelText('HTTPS')).toBeInTheDocument()
    expect(screen.queryByLabelText('Local domain')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Tailscale auth key')).not.toBeInTheDocument()
    expect(document.title).toBe('TLS · Settings · Portta')
    expect(screen.getByRole('link', { name: 'TLS' })).toHaveAttribute('aria-current', 'page')
  })

  it('keeps one draft across groups and saves all changes together', async () => {
    const rendered = renderWithQuery(<Settings group="gateway" />)
    const domain = await screen.findByLabelText('Local domain')
    await userEvent.clear(domain)
    await userEvent.type(domain, 'dev.test')

    rendered.rerender(<Settings group="vpn" />)
    const token = await screen.findByLabelText('Tailscale auth key')
    await userEvent.type(token, 'new-secret')

    const nav = screen.getByRole('navigation', { name: 'Settings groups' })
    expect(
      within(screen.getByRole('link', { name: 'Gateway, 1 unsaved' })).getByText('1'),
    ).toBeInTheDocument()
    expect(within(screen.getByRole('link', { name: 'VPN, 1 unsaved' })).getByText('1')).toBeInTheDocument()
    expect(within(nav).getAllByText('1')).toHaveLength(2)
    expect(screen.getByText('2 unsaved')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(patchConfig).toHaveBeenCalledWith({
        PORTTA_DOMAIN: 'dev.test',
        TS_AUTHKEY: 'new-secret',
      }),
    )
  })

  it('redirects the settings root to the first server-defined group', async () => {
    renderWithQuery(<Settings group={null} />)
    await screen.findByLabelText('Local domain')
    await waitFor(() => expect(window.location.hash).toBe('#/settings/gateway'))
  })

  it('shows an empty state for an unknown group without hiding the navigation', async () => {
    renderWithQuery(<Settings group="missing" />)
    expect(await screen.findByText('Settings section “missing” does not exist')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Settings groups' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Local domain')).not.toBeInTheDocument()
  })
})
