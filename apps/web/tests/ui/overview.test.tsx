import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithQuery } from './render.tsx'
import type { Overview as OverviewData } from '../../src/shared/types.ts'

const overview = vi.fn()

vi.mock('../../src/ui/lib/api.ts', () => ({
  ApiError: class ApiError extends Error {},
  api: { overview: () => overview() },
}))

const { Overview } = await import('../../src/ui/pages/Overview.tsx')

const data: OverviewData = {
  generatedAt: 1_700_000_000,
  gateway: {
    gatewayVersion: '0.2.0',
    panelVersion: '0.1.0',
    profile: 'local',
    domain: 'localhost',
    privateDomain: null,
    publicDomain: null,
    bindAddress: '127.0.0.1',
    httpPort: '80',
    httpsPort: '443',
    scheme: 'http',
    up: true,
    reachable: true,
    tls: { enabled: false, mode: 'local' },
    tailscale: { enabled: false, running: false, hostname: 'portta' },
    publicAccess: { enabled: false, domain: null },
    panel: {
      expose: 'local',
      routed: false,
      auth: 'none',
      authenticated: false,
      user: '',
      readOnly: false,
      docs: true,
    },
    dashboard: { enabled: false, bindAddress: '127.0.0.1', port: '8080' },
    traefik: { containerId: 'gw', state: 'running', health: 'healthy' },
    socketProxy: { containerId: 'sp', state: 'running' },
    database: { containerId: 'db', state: 'running', health: 'healthy' },
    network: { name: 'portta', exists: true, attached: 3, internal: false },
    routes: 3,
  },
  counts: {
    projects: 3,
    integratedProjects: 2,
    services: 5,
    servicesRunning: 5,
    servicesHealthy: 3,
    servicesUnhealthy: 1,
    containersTotal: 9,
    containersRunning: 8,
    containersGateway: 2,
    containersIntegrated: 5,
    containersExternal: 1,
    containersStandalone: 0,
    shares: 0,
    sharesStale: 0,
    bridges: 1,
    forwarders: 0,
    routes: 3,
  },
  urls: [
    { url: 'http://alpha-web.localhost', host: 'alpha-web.localhost', scope: 'local', scheme: 'http' },
    { url: 'https://alpha-web.vpn.test', host: 'alpha-web.vpn.test', scope: 'vpn', scheme: 'https' },
  ],
  problems: [
    {
      id: 'unhealthy',
      status: 'warn',
      title: 'Unhealthy containers',
      detail: 'beta-web-1',
      fix: 'open the container logs',
    },
  ],
}

beforeEach(() => overview.mockReset().mockResolvedValue(data))

const tile = (name: string) =>
  screen.getByRole('group', { name }).querySelector('[data-slot="value"]')?.textContent

describe('the Overview answers the questions the dashboard is for', () => {
  it('is the gateway running?', async () => {
    renderWithQuery(<Overview />)
    expect(await screen.findByText('Gateway running')).toBeInTheDocument()
  })

  it('how many projects, services and containers?', async () => {
    renderWithQuery(<Overview />)
    await screen.findByRole('group', { name: 'Projects' })

    expect(tile('Projects')).toBe('2')
    expect(tile('Services')).toBe('5/5')
    expect(tile('Routed URLs')).toBe('3')
    expect(tile('Containers running')).toBe('8')
    expect(tile('Outside the gateway')).toBe('1')
  })

  it('what is wrong right now?', async () => {
    renderWithQuery(<Overview />)
    expect(await screen.findByText('Unhealthy containers')).toBeInTheDocument()
    expect(screen.getByText('beta-web-1')).toBeInTheDocument()
    expect(screen.getByText('open the container logs')).toBeInTheDocument()
    expect(tile('Problems')).toBe('1')
  })

  it('which URLs are available, and where do they reach?', async () => {
    renderWithQuery(<Overview />)
    expect(await screen.findByText('http://alpha-web.localhost')).toBeInTheDocument()
    expect(screen.getByText('https://alpha-web.vpn.test')).toBeInTheDocument()
    expect(screen.getByText('VPN')).toBeInTheDocument()
  })

  it('says plainly when there is nothing wrong', async () => {
    overview.mockResolvedValue({ ...data, problems: [] })
    renderWithQuery(<Overview />)
    expect(await screen.findByText('No problems detected.')).toBeInTheDocument()
  })

  it('says the gateway is down when it is', async () => {
    overview.mockResolvedValue({ ...data, gateway: { ...data.gateway, up: false } })
    renderWithQuery(<Overview />)
    expect(await screen.findByText('Gateway down')).toBeInTheDocument()
  })
})
