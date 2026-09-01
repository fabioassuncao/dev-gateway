import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { renderWithQuery } from './render.tsx'
import { makeContainer } from './fixtures.ts'
import type { Project, ProjectGit } from '../../src/shared/types.ts'

class ApiError extends Error {
  status: number
  hint: string
  constructor(status: number, message: string, hint = '') {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.hint = hint
  }
}

const project = vi.fn()
const projectGit = vi.fn()

vi.mock('../../src/ui/lib/api.ts', () => ({
  ApiError,
  api: {
    project: (name: string) => project(name),
    projectGit: (name: string) => projectGit(name),
    containerAction: vi.fn().mockResolvedValue({ ok: true }),
    logs: vi.fn().mockResolvedValue({ lines: [], truncated: false }),
    removalPreview: vi.fn().mockResolvedValue({ allowed: true, warnings: [], namedVolumes: [] }),
    stats: vi.fn().mockResolvedValue({ cpuPercent: null }),
    shares: vi.fn().mockResolvedValue({ shares: [] }),
    serviceTraefik: vi.fn().mockResolvedValue({ available: false, reason: 'not configured' }),
  },
}))

const { ProjectPage, resolveTab } = await import('../../src/ui/pages/Project.tsx')

const WEB_URL = {
  url: 'http://alpha-web.localhost',
  host: 'alpha-web.localhost',
  scope: 'local' as const,
  scheme: 'http' as const,
}

const alpha: Project = {
  name: 'alpha',
  integrated: true,
  workingDir: '/srv/dev/alpha',
  namespace: null,
  group: null,
  repo: null,
  repoUrl: null,
  gitRoot: null,
  serviceCount: 2,
  runningCount: 2,
  healthyCount: 1,
  unhealthyCount: 0,
  networks: ['dev-gateway', 'alpha_default'],
  startedAt: 1_700_000_000,
  uptimeSeconds: 7200,
  scopes: ['local'],
  urls: [WEB_URL],
  services: [
    makeContainer({
      id: 'a-web', name: 'alpha-web-1', project: 'alpha', service: 'web',
      ownership: 'integrated', traefikEnabled: true, kind: 'http',
      exposedPorts: [3000], uptimeSeconds: 7200, urls: [WEB_URL],
      mounts: [{ type: 'bind', name: null, source: '/srv/dev/alpha', destination: '/app', rw: true }],
      restartCount: 4,
    }),
    makeContainer({
      id: 'a-postgres', name: 'alpha-postgres-1', image: 'postgres:18.6-alpine',
      project: 'alpha', service: 'postgres', ownership: 'integrated', kind: 'postgres',
      exposedPorts: [5432],
    }),
  ],
}

const gitScan: ProjectGit = {
  project: 'alpha',
  collected: true,
  collectedAt: 1_700_000_000,
  ageSeconds: 10,
  stale: false,
  staleAfterSeconds: 900,
  workingDir: '/srv/dev/alpha',
  git: {
    branch: 'fix/182-tcp-proxy',
    detached: false,
    head: { sha: 'abc1234def', shortSha: 'abc1234', subject: 'Fix the proxy', author: 'Someone', date: 1_700_000_000 },
    staged: 1, unstaged: 2, untracked: 0, unmerged: 0, dirty: true,
    upstream: 'origin/fix/182-tcp-proxy', ahead: 3, behind: 0, remote: 'origin',
  },
  remote: {
    url: 'git@github.com:acme/alpha.git', host: 'github.com',
    slug: 'acme/alpha', kind: 'github', repoUrl: 'https://github.com/acme/alpha',
  },
  links: {
    repo: 'https://github.com/acme/alpha',
    commit: 'https://github.com/acme/alpha/commit/abc1234def',
    branch: 'https://github.com/acme/alpha/tree/fix/182-tcp-proxy',
  },
  forge: {
    kind: 'github',
    collectedAt: 1_700_000_000,
    authenticated: true,
    reason: null,
    // Five, so the card's slice(0, 4) would have hidden one.
    pulls: [1, 2, 3, 4, 5].map((number) => ({
      number,
      title: `Pull ${number}`,
      state: 'OPEN',
      draft: false,
      reviewDecision: null,
      checks: null,
      url: `https://github.com/acme/alpha/pull/${number}`,
      headRefName: `feat/${number}`,
    })),
  },
  reason: null,
  refreshCommand: 'dev-gateway git scan --project alpha',
}

beforeEach(() => {
  project.mockReset().mockResolvedValue(alpha)
  projectGit.mockReset().mockResolvedValue(gitScan)
  window.location.hash = '/projects/alpha'
})

describe('resolveTab', () => {
  it('falls back to Overview for an unknown tab', () => {
    expect(resolveTab(null)).toBe('overview')
    expect(resolveTab('nope')).toBe('overview')
    expect(resolveTab('git')).toBe('git')
  })
})

describe('Project page', () => {
  it('fetches one project instead of the whole list', async () => {
    renderWithQuery(<ProjectPage project="alpha" tab={null} service={null} />)
    await screen.findByRole('heading', { name: 'alpha' })
    expect(project).toHaveBeenCalledWith('alpha')
  })

  it('shows the environment, its host directory and endpoints on Overview', async () => {
    renderWithQuery(<ProjectPage project="alpha" tab="overview" service={null} />)
    expect(await screen.findByText('/srv/dev/alpha')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Services' })).toHaveTextContent('2/2')
    expect(screen.getByRole('link', { name: /alpha-web.localhost/ })).toBeInTheDocument()
    expect(screen.getByText('dev-gateway, alpha_default')).toBeInTheDocument()
  })

  it('lists every service with mounts, networks and restart counts', async () => {
    renderWithQuery(<ProjectPage project="alpha" tab="services" service={null} />)
    expect(await screen.findByText('4 restarts')).toBeInTheDocument()
    expect(screen.getByText(/bind: \/srv\/dev\/alpha → \/app/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /postgres/ })).toBeInTheDocument()
  })

  it('shows every open pull request on the Git tab, not the first four', async () => {
    renderWithQuery(<ProjectPage project="alpha" tab="git" service={null} />)
    expect(await screen.findByRole('link', { name: '#5 Pull 5' })).toBeInTheDocument()
    expect(screen.getByText('origin/fix/182-tcp-proxy')).toBeInTheDocument()
    expect(screen.getByText('dev-gateway git scan --project alpha')).toBeInTheDocument()
  })

  it('renders the Git tab without an error when the project has no repository', async () => {
    projectGit.mockResolvedValue({ ...gitScan, git: null, remote: null, forge: null, reason: 'not a Git work tree' })
    renderWithQuery(<ProjectPage project="alpha" tab="git" service={null} />)
    expect(await screen.findByText('This project has no Git repository')).toBeInTheDocument()
  })

  it('reports a project that stopped existing with a way back to the list', async () => {
    project.mockRejectedValue(new ApiError(404, "no project 'ghost' is running"))
    renderWithQuery(<ProjectPage project="ghost" tab={null} service={null} />)
    expect(await screen.findByText("No project 'ghost' is running")).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to all projects' })).toHaveAttribute('href', '#/projects')
  })

  it('renders an empty state for a project with no services', async () => {
    project.mockResolvedValue({ ...alpha, services: [], serviceCount: 0, runningCount: 0 })
    renderWithQuery(<ProjectPage project="alpha" tab="services" service={null} />)
    expect(await screen.findByText('This project has no services')).toBeInTheDocument()
  })

  it('titles the document with the tab and the project', async () => {
    renderWithQuery(<ProjectPage project="alpha" tab="git" service={null} />)
    await waitFor(() => expect(document.title).toBe('Git · alpha · Dev Gateway'))
  })

  it('titles the document with the project alone on Overview', async () => {
    renderWithQuery(<ProjectPage project="alpha" tab={null} service={null} />)
    await waitFor(() => expect(document.title).toBe('alpha · Dev Gateway'))
  })

  it('makes every tab a link that survives a reload', async () => {
    renderWithQuery(<ProjectPage project="alpha" tab="overview" service={null} />)
    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map((tab) => tab.getAttribute('href'))).toEqual([
      '#/projects/alpha/overview',
      '#/projects/alpha/services',
      '#/projects/alpha/git',
      '#/projects/alpha/logs',
    ])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[2]).toHaveAttribute('aria-selected', 'false')
  })

  it('navigates to the next tab with the arrow keys', async () => {
    renderWithQuery(<ProjectPage project="alpha" tab="overview" service={null} />)
    const list = await screen.findByRole('tablist')
    within(list).getAllByRole('tab')[0]!.focus()
    await userEvent.keyboard('{ArrowRight}')
    await waitFor(() => expect(window.location.hash).toBe('#/projects/alpha/services'))
  })

  it('encodes a project name that needs it in every tab link', async () => {
    project.mockResolvedValue({ ...alpha, name: 'alpha_beta-1' })
    renderWithQuery(<ProjectPage project="alpha_beta-1" tab="overview" service={null} />)
    const tabs = await screen.findAllByRole('tab')
    expect(tabs[0]).toHaveAttribute('href', '#/projects/alpha_beta-1/overview')
  })
})
