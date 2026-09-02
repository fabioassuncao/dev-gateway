import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { renderWithQuery } from './render.tsx'
import { makeContainer, makeOperable, makeStartable } from './fixtures.ts'
import type { Project } from '../../src/shared/types.ts'

const projects = vi.fn()
const containerAction = vi.fn()
const projectAction = vi.fn()

vi.mock('../../src/ui/lib/api.ts', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    projects: () => projects(),
    containerAction: (...args: unknown[]) => containerAction(...args),
    projectAction: (...args: unknown[]) => projectAction(...args),
    logs: vi.fn().mockResolvedValue({ lines: [] }),
    removalPreview: vi.fn().mockResolvedValue({ allowed: true, warnings: [], namedVolumes: [] }),
    stats: vi.fn().mockResolvedValue({ cpuPercent: null }),
    shares: vi.fn().mockResolvedValue([]),
    serviceTraefik: vi.fn().mockResolvedValue({ available: false, reason: 'not configured' }),
    // Nothing collected: the card renders one subtle line and the page is
    // unchanged, which is what a project without a scan should look like.
    projectGit: vi.fn().mockResolvedValue({ collected: false, git: null, refreshCommand: 'git scan' }),
  },
}))

const { Projects } = await import('../../src/ui/pages/Projects.tsx')
const { orderedEndpoints } = await import('../../src/ui/components/project-services.tsx')

const WEB_URL = {
  url: 'http://alpha-web.localhost',
  host: 'alpha-web.localhost',
  scope: 'local' as const,
  scheme: 'http' as const,
}

const API_URLS = [
  {
    url: 'https://alpha-api.vpn.example.test',
    host: 'alpha-api.vpn.example.test',
    scope: 'vpn' as const,
    scheme: 'https' as const,
  },
  {
    url: 'http://alpha-api.localhost',
    host: 'alpha-api.localhost',
    scope: 'local' as const,
    scheme: 'http' as const,
  },
  {
    url: 'https://alpha-api.localhost',
    host: 'alpha-api.localhost',
    scope: 'local' as const,
    scheme: 'https' as const,
  },
]

const alpha: Project = {
  name: 'alpha',
  integrated: true,
  workingDir: '/srv/dev/alpha',
  operable: makeOperable('/srv/dev/alpha'),
  startable: makeStartable(),
  namespace: null,
  group: null,
  repo: null,
  repoUrl: null,
  gitRoot: null,
  serviceCount: 4,
  runningCount: 4,
  healthyCount: 2,
  unhealthyCount: 0,
  networks: ['portta', 'alpha_default'],
  startedAt: 1_700_000_000,
  uptimeSeconds: 7200,
  scopes: ['local'],
  urls: [WEB_URL, ...API_URLS],
  services: [
    makeContainer({ id: 'a-web', name: 'alpha-web-1', project: 'alpha', service: 'web', ownership: 'integrated', traefikEnabled: true, kind: 'http', exposedPorts: [3000], uptimeSeconds: 7200, urls: [WEB_URL] }),
    makeContainer({ id: 'a-postgres', name: 'alpha-postgres-1', image: 'postgres:18.6-alpine', project: 'alpha', service: 'postgres', ownership: 'integrated', kind: 'postgres', exposedPorts: [5432] }),
    makeContainer({ id: 'a-redis', name: 'alpha-redis-1', image: 'redis:8.10.1-alpine', project: 'alpha', service: 'redis', ownership: 'integrated', kind: 'redis', exposedPorts: [6379] }),
    makeContainer({ id: 'a-api', name: 'alpha-api-1', project: 'alpha', service: 'api', ownership: 'integrated', traefikEnabled: true, kind: 'http', urls: API_URLS }),
  ],
}

const beta: Project = {
  ...alpha,
  name: 'beta',
  namespace: 'beta-issue59',
  serviceCount: 1,
  runningCount: 1,
  unhealthyCount: 1,
  urls: [],
  services: [makeContainer({ id: 'b-web', name: 'beta-web-1', project: 'beta', service: 'web', ownership: 'integrated', health: 'unhealthy', traefikEnabled: true, kind: 'http' })],
}

beforeEach(() => {
  projects.mockReset().mockResolvedValue([alpha, beta])
  containerAction.mockReset().mockResolvedValue({ ok: true })
  projectAction.mockReset()
})

describe('the Projects page', () => {
  it('shows projects and their services, not a flat container list', async () => {
    renderWithQuery(<Projects />)
    await screen.findByText('alpha')

    expect(screen.getByText('4/4 running')).toBeInTheDocument()
    for (const service of ['web', 'postgres', 'redis', 'api']) {
      expect(screen.getAllByRole('group', { name: `${service} service` }).length).toBeGreaterThan(0)
    }
  })

  it('keeps the service name next to a technology icon', async () => {
    renderWithQuery(<Projects />)
    await screen.findByText('alpha')
    const postgres = within(screen.getByRole('group', { name: 'postgres service' })).getByRole('button', { name: 'postgres' })
    expect(postgres.querySelector('svg')).not.toBeNull()
    expect(postgres).toHaveTextContent('postgres')
  })

  it('falls back to a generic mark for opaque images', async () => {
    projects.mockResolvedValue([
      {
        ...alpha,
        services: [
          makeContainer({
            id: 'a-web',
            name: 'alpha-web-1',
            image: 'traefik/whoami:v1.12.0',
            project: 'alpha',
            service: 'web',
            ownership: 'integrated',
            traefikEnabled: true,
            kind: 'http',
          }),
        ],
        serviceCount: 1,
        runningCount: 1,
      },
    ])
    renderWithQuery(<Projects />)
    const button = await screen.findByRole('button', { name: 'web' })
    expect(button.querySelector('svg')).not.toBeNull()
    expect(button).toHaveTextContent('web')
  })

  it('flags the worktree and the unhealthy service', async () => {
    renderWithQuery(<Projects />)
    expect(await screen.findByText('worktree: beta-issue59')).toBeInTheDocument()
    expect(screen.getByText('1 unhealthy')).toBeInTheDocument()
  })

  it('offers the project URLs for copying', async () => {
    renderWithQuery(<Projects />)
    const web = (await screen.findAllByRole('group', { name: 'web service' }))[0] as HTMLElement
    expect(within(web).getByText('http://alpha-web.localhost')).toBeInTheDocument()
    await userEvent.click(within(web).getByRole('button', { name: 'Copy' }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('http://alpha-web.localhost')
  })

  it('orders and groups every endpoint under its service', async () => {
    expect(orderedEndpoints(API_URLS).map((endpoint) => endpoint.url)).toEqual([
      'https://alpha-api.localhost',
      'http://alpha-api.localhost',
      'https://alpha-api.vpn.example.test',
    ])

    renderWithQuery(<Projects />)
    const api = await screen.findByRole('group', { name: 'api service' })
    const addresses = [...api.querySelectorAll('a[target="_blank"]')]
      .map((link) => link.textContent)
      .filter(Boolean)
    expect(addresses).toEqual([
      'https://alpha-api.localhost',
      'http://alpha-api.localhost',
      'https://alpha-api.vpn.example.test',
    ])
    expect(within(api).getAllByText('local')).toHaveLength(2)
    expect(within(api).getByText('VPN')).toBeInTheDocument()
  })

  it('explains TCP access and flags an HTTP routing problem', async () => {
    renderWithQuery(<Projects />)

    const postgres = await screen.findByRole('group', { name: 'postgres service' })
    expect(within(postgres).getByText(/reachable through the/)).toBeInTheDocument()
    expect(within(postgres).getByRole('link', { name: 'Access page' })).toHaveAttribute('href', '#/access')

    const broken = screen.getAllByRole('group', { name: 'web service' })[1] as HTMLElement
    expect(within(broken).getByText('routing problem')).toBeInTheDocument()
    expect(within(broken).getByText(/no endpoint was discovered/)).toBeInTheDocument()
  })

  it('does not present stale endpoints for a stopped service', async () => {
    projects.mockResolvedValue([
      {
        ...alpha,
        serviceCount: 1,
        runningCount: 0,
        urls: [WEB_URL],
        services: [
          makeContainer({
            id: 'a-web',
            name: 'alpha-web-1',
            project: 'alpha',
            service: 'web',
            ownership: 'integrated',
            state: 'exited',
            kind: 'http',
            traefikEnabled: true,
            urls: [WEB_URL],
          }),
        ],
      },
    ])

    renderWithQuery(<Projects />)
    const web = (await screen.findAllByRole('group', { name: 'web service' }))[0] as HTMLElement
    expect(within(web).getByText(/No live endpoint while web is exited/)).toBeInTheDocument()
    expect(within(web).queryByText(WEB_URL.url)).not.toBeInTheDocument()
  })

  it('keeps image, kind, ports, uptime, details and actions in the service row', async () => {
    renderWithQuery(<Projects />)
    const web = (await screen.findAllByRole('group', { name: 'web service' }))[0] as HTMLElement

    expect(web).toHaveTextContent('http')
    expect(web).toHaveTextContent('nginx:1.31.4-alpine')
    expect(web).toHaveTextContent('ports 3000')
    expect(web).toHaveTextContent('up 2h 0m')
    expect(within(web).getByRole('button', { name: 'web' })).toBeInTheDocument()
    expect(within(web).getByRole('button', { name: 'Actions for alpha-web-1' })).toBeInTheDocument()
  })

  it('keeps a project with only TCP services useful without a URL strip', async () => {
    projects.mockResolvedValue([
      {
        ...alpha,
        serviceCount: 1,
        runningCount: 1,
        urls: [],
        services: [alpha.services[1]!],
      },
    ])

    renderWithQuery(<Projects />)
    const postgres = await screen.findByRole('group', { name: 'postgres service' })
    expect(within(postgres).getByRole('link', { name: 'Access page' })).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('does not promise Access for a generic service with no exposed port', async () => {
    projects.mockResolvedValue([
      {
        ...alpha,
        serviceCount: 1,
        runningCount: 1,
        urls: [],
        services: [
          makeContainer({
            id: 'a-worker',
            name: 'alpha-worker-1',
            image: 'python:3.13-alpine',
            project: 'alpha',
            service: 'worker',
            ownership: 'integrated',
            kind: 'tcp',
            exposedPorts: [],
          }),
        ],
      },
    ])

    renderWithQuery(<Projects />)
    const worker = await screen.findByRole('group', { name: 'worker service' })
    expect(within(worker).getByText(/No exposed TCP port/)).toBeInTheDocument()
    expect(within(worker).queryByRole('link', { name: 'Access page' })).not.toBeInTheDocument()
  })

  it('links the project heading to its contextual route', async () => {
    renderWithQuery(<Projects />)
    expect(await screen.findByRole('link', { name: 'alpha' })).toHaveAttribute('href', '#/projects/alpha')
  })

  it('restarts a project as one action, not a loop over services', async () => {
    projectAction.mockResolvedValue({ ok: true, project: 'alpha', action: 'restart', requested: 4, succeeded: 4, failed: 0, skipped: 0, results: [] })
    renderWithQuery(<Projects />)
    await screen.findByText('alpha')

    await userEvent.click(screen.getAllByRole('button', { name: 'Restart' })[0] as HTMLElement)
    await waitFor(() => expect(projectAction).toHaveBeenCalledWith('alpha', 'restart'))
    expect(containerAction).not.toHaveBeenCalled()
  })

  it('filters by search across services and images', async () => {
    renderWithQuery(<Projects />)
    await screen.findByText('alpha')

    await userEvent.type(screen.getByLabelText('Search projects'), 'redis')
    await waitFor(() => expect(screen.queryByText('worktree: beta-issue59')).not.toBeInTheDocument())
  })

  it('explains how to adopt a project when there is none', async () => {
    projects.mockResolvedValue([])
    renderWithQuery(<Projects />)
    expect(await screen.findByText('No integrated project is running')).toBeInTheDocument()
    expect(screen.getByText(/docs\/adopting-projects.md/)).toBeInTheDocument()
  })
})
