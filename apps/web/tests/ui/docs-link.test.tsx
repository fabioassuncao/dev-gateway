import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithQuery } from './render.tsx'

const overview = vi.fn()

vi.mock('../../src/ui/lib/api/index.ts', () => ({
  ApiError: class ApiError extends Error {},
  api: { overview: () => overview(), events: () => ({ close: () => {} }) },
}))

const { App } = await import('../../src/ui/App.tsx')

function payload(docs: boolean) {
  return {
    generatedAt: 1_700_000_000,
    gateway: {
      gatewayVersion: '0.4.0', panelVersion: '0.1.0', profile: 'local', domain: 'localhost',
      privateDomain: null, publicDomain: null, bindAddress: '127.0.0.1', httpPort: '80',
      httpsPort: '443', scheme: 'http', up: true, reachable: true,
      tls: { enabled: false, mode: 'local' },
      tailscale: { enabled: false, running: false, hostname: 'portta' },
      publicAccess: { enabled: false, domain: null },
      panel: { expose: 'local', routed: false, auth: 'none', authenticated: false, user: '', readOnly: false, docs },
      dashboard: { enabled: false, bindAddress: '127.0.0.1', port: '8080', expose: 'local', advertisedHost: null, authenticated: false, endpoints: [] },
      traefik: { containerId: 'a', state: 'running', health: 'healthy' },
      socketProxy: { containerId: 'b', state: 'running' },
      database: { containerId: null, state: 'absent', health: 'none' },
      network: { name: 'portta', exists: true, attached: 3, internal: false },
      routes: 0,
    },
    counts: {
      projects: 0, integratedProjects: 0, services: 0, servicesRunning: 0, servicesHealthy: 0,
      servicesUnhealthy: 0, containersTotal: 0, containersRunning: 0, containersGateway: 0,
      containersIntegrated: 0, containersExternal: 0, containersStandalone: 0, bridges: 0,
      forwarders: 0, routes: 0, shares: 0, sharesStale: 0,
    },
    urls: [], problems: [],
  }
}

beforeEach(() => { overview.mockReset() })

describe('the documentation link in the sidebar footer', () => {
  it('opens the documentation in a new tab', async () => {
    overview.mockResolvedValue(payload(true))
    renderWithQuery(<App />)
    const link = await screen.findByRole('link', { name: 'Documentation' })
    expect(link).toHaveAttribute('href', '/docs/')
    expect(link).toHaveAttribute('target', '_blank')
    // Opening a new tab without this hands the documentation a reference back
    // into the panel through `window.opener`.
    expect(link).toHaveAttribute('rel', 'noreferrer')
  })

  // The panel must never offer a link to a 404: whether the docs are served is
  // the panel's own answer, carried on the status payload.
  it('is absent when the panel does not serve the documentation', async () => {
    overview.mockResolvedValue(payload(false))
    renderWithQuery(<App />)
    await screen.findByRole('button', { name: /theme/i })
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'Documentation' })).not.toBeInTheDocument()
    })
  })
})
