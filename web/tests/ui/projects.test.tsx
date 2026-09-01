import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { renderWithQuery } from './render.tsx'
import { makeContainer } from './fixtures.ts'
import type { Project } from '../../src/shared/types.ts'

const projects = vi.fn()
const containerAction = vi.fn()

vi.mock('../../src/ui/lib/api.ts', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    projects: () => projects(),
    containerAction: (...args: unknown[]) => containerAction(...args),
    logs: vi.fn().mockResolvedValue({ lines: [] }),
    removalPreview: vi.fn().mockResolvedValue({ allowed: true, warnings: [], namedVolumes: [] }),
    stats: vi.fn().mockResolvedValue({ cpuPercent: null }),
  },
}))

const { Projects } = await import('../../src/ui/pages/Projects.tsx')

const alpha: Project = {
  name: 'alpha',
  integrated: true,
  workingDir: '/srv/dev/alpha',
  namespace: null,
  serviceCount: 4,
  runningCount: 4,
  healthyCount: 2,
  unhealthyCount: 0,
  networks: ['dev-gateway', 'alpha_default'],
  startedAt: 1_700_000_000,
  uptimeSeconds: 7200,
  scopes: ['local'],
  urls: [
    { url: 'http://alpha-web.localhost', host: 'alpha-web.localhost', scope: 'local', scheme: 'http' },
  ],
  services: [
    makeContainer({ id: 'a-web', name: 'alpha-web-1', project: 'alpha', service: 'web', ownership: 'integrated', traefikEnabled: true, kind: 'http' }),
    makeContainer({ id: 'a-postgres', name: 'alpha-postgres-1', image: 'postgres:18.6-alpine', project: 'alpha', service: 'postgres', ownership: 'integrated', kind: 'postgres', exposedPorts: [5432] }),
    makeContainer({ id: 'a-redis', name: 'alpha-redis-1', image: 'redis:8.10.1-alpine', project: 'alpha', service: 'redis', ownership: 'integrated', kind: 'redis', exposedPorts: [6379] }),
    makeContainer({ id: 'a-api', name: 'alpha-api-1', project: 'alpha', service: 'api', ownership: 'integrated', traefikEnabled: true, kind: 'http' }),
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
  services: [makeContainer({ id: 'b-web', name: 'beta-web-1', project: 'beta', service: 'web', ownership: 'integrated', health: 'unhealthy' })],
}

beforeEach(() => {
  projects.mockReset().mockResolvedValue([alpha, beta])
  containerAction.mockReset().mockResolvedValue({ ok: true })
})

describe('the Projects page', () => {
  it('shows projects and their services, not a flat container list', async () => {
    renderWithQuery(<Projects selected={null} />)
    await screen.findByText('alpha')

    expect(screen.getByText('4/4 running')).toBeInTheDocument()
    const services = screen.getAllByRole('table')[0] as HTMLElement
    for (const service of ['web', 'postgres', 'redis', 'api']) {
      expect(within(services).getByRole('button', { name: service })).toBeInTheDocument()
    }
  })

  it('keeps the service name next to a technology icon', async () => {
    renderWithQuery(<Projects selected={null} />)
    await screen.findByText('alpha')
    const services = screen.getAllByRole('table')[0] as HTMLElement
    const postgres = within(services).getByRole('button', { name: 'postgres' })
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
    renderWithQuery(<Projects selected={null} />)
    const button = await screen.findByRole('button', { name: 'web' })
    expect(button.querySelector('svg')).not.toBeNull()
    expect(button).toHaveTextContent('web')
  })

  it('flags the worktree and the unhealthy service', async () => {
    renderWithQuery(<Projects selected={null} />)
    expect(await screen.findByText('worktree: beta-issue59')).toBeInTheDocument()
    expect(screen.getByText('1 unhealthy')).toBeInTheDocument()
  })

  it('offers the project URLs for copying', async () => {
    renderWithQuery(<Projects selected={null} />)
    await screen.findByText('http://alpha-web.localhost')
    await userEvent.click(screen.getAllByRole('button', { name: 'Copy' })[0] as HTMLElement)
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('http://alpha-web.localhost')
  })

  it('restarts every running service of one project only', async () => {
    renderWithQuery(<Projects selected={null} />)
    await screen.findByText('alpha')

    await userEvent.click(screen.getAllByRole('button', { name: /Restart services/ })[0] as HTMLElement)
    await waitFor(() => expect(containerAction).toHaveBeenCalledTimes(4))
    expect(containerAction.mock.calls.map((call) => call[0])).toEqual([
      'a-web',
      'a-postgres',
      'a-redis',
      'a-api',
    ])
    expect(containerAction.mock.calls.every((call) => call[1] === 'restart')).toBe(true)
  })

  it('narrows to one project when the route names it', async () => {
    renderWithQuery(<Projects selected="beta" />)
    await screen.findByText('worktree: beta-issue59')
    expect(screen.queryByText('4/4 running')).not.toBeInTheDocument()
  })

  it('filters by search across services and images', async () => {
    renderWithQuery(<Projects selected={null} />)
    await screen.findByText('alpha')

    await userEvent.type(screen.getByLabelText('Search projects'), 'redis')
    await waitFor(() => expect(screen.queryByText('worktree: beta-issue59')).not.toBeInTheDocument())
  })

  it('explains how to adopt a project when there is none', async () => {
    projects.mockResolvedValue([])
    renderWithQuery(<Projects selected={null} />)
    expect(await screen.findByText('No integrated project is running')).toBeInTheDocument()
    expect(screen.getByText(/docs\/adopting-projects.md/)).toBeInTheDocument()
  })
})
