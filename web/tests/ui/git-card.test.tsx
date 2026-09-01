import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithQuery } from './render.tsx'
import type { ProjectGit } from '../../src/shared/types.ts'

const projectGit = vi.fn()

vi.mock('../../src/ui/lib/api.ts', () => ({
  ApiError: class ApiError extends Error {},
  api: { projectGit: (name: string) => projectGit(name) },
}))

const { GitCard } = await import('../../src/ui/components/git-card.tsx')

function collected(overrides: Partial<ProjectGit> = {}): ProjectGit {
  return {
    project: 'alpha',
    collected: true,
    collectedAt: Math.floor(Date.now() / 1000) - 240,
    ageSeconds: 240,
    stale: false,
    staleAfterSeconds: 600,
    workingDir: '/srv/dev/alpha',
    git: {
      branch: 'feature/59-invoices',
      detached: false,
      head: {
        sha: '9f2c1abfeed',
        shortSha: '9f2c1ab',
        subject: 'Add invoice totals',
        author: 'Someone',
        date: Math.floor(Date.now() / 1000) - 3600,
      },
      staged: 2,
      unstaged: 5,
      untracked: 0,
      unmerged: 0,
      dirty: true,
      upstream: 'origin/feature/59-invoices',
      ahead: 3,
      behind: 0,
      remote: 'git@github.com:owner/repo.git',
    },
    remote: {
      url: 'git@github.com:owner/repo.git',
      host: 'github.com',
      slug: 'owner/repo',
      kind: 'github',
      repoUrl: 'https://github.com/owner/repo',
    },
    links: {
      repo: 'https://github.com/owner/repo',
      commit: 'https://github.com/owner/repo/commit/9f2c1abfeed',
      branch: 'https://github.com/owner/repo/tree/feature/59-invoices',
    },
    forge: null,
    reason: null,
    refreshCommand: './bin/dev-gateway git scan --project alpha',
    ...overrides,
  }
}

beforeEach(() => {
  projectGit.mockReset()
})

describe('the Git card', () => {
  it('answers what this environment is running, on one line', async () => {
    projectGit.mockResolvedValue(collected())
    renderWithQuery(<GitCard project="alpha" />)

    expect(await screen.findByText('feature/59-invoices')).toBeInTheDocument()
    expect(screen.getByText('9f2c1ab')).toBeInTheDocument()
    expect(screen.getByText('Add invoice totals')).toBeInTheDocument()
    expect(screen.getByText('7 uncommitted changes')).toBeInTheDocument()
    expect(screen.getByText('3 ahead')).toBeInTheDocument()
  })

  it('links the branch, the commit and the repository', async () => {
    projectGit.mockResolvedValue(collected())
    renderWithQuery(<GitCard project="alpha" />)

    expect((await screen.findByText('feature/59-invoices')).closest('a')).toHaveAttribute(
      'href',
      'https://github.com/owner/repo/tree/feature/59-invoices',
    )
    expect(screen.getByText('owner/repo').closest('a')).toHaveAttribute(
      'href',
      'https://github.com/owner/repo',
    )
  })

  it('always says how old the answer is', async () => {
    projectGit.mockResolvedValue(collected())
    renderWithQuery(<GitCard project="alpha" />)
    expect(await screen.findByText(/collected/)).toBeInTheDocument()
  })

  it('marks a stale scan rather than presenting it as current', async () => {
    projectGit.mockResolvedValue(collected({ stale: true, ageSeconds: 40_000 }))
    const { container } = renderWithQuery(<GitCard project="alpha" />)
    await screen.findByText('feature/59-invoices')
    expect(container.querySelector('[title*="older than"]')).not.toBeNull()
  })

  it('shows the host command when nobody has scanned yet', async () => {
    projectGit.mockResolvedValue(collected({ collected: false, git: null, collectedAt: null }))
    renderWithQuery(<GitCard project="alpha" />)
    expect(await screen.findByText('./bin/dev-gateway git scan --project alpha')).toBeInTheDocument()
  })

  it('renders nothing at all for a project without Git', async () => {
    projectGit.mockResolvedValue(collected({ git: null, remote: null, reason: 'not a git repository' }))
    const { container } = renderWithQuery(<GitCard project="alpha" />)
    await waitFor(() => expect(projectGit).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('renders nothing when the request fails, rather than an error banner', async () => {
    projectGit.mockRejectedValue(new Error('nope'))
    const { container } = renderWithQuery(<GitCard project="alpha" />)
    await waitFor(() => expect(projectGit).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('says a detached HEAD is one, instead of naming a branch', async () => {
    projectGit.mockResolvedValue(
      collected({
        git: { ...collected().git!, branch: null, detached: true },
        links: { repo: 'https://github.com/owner/repo', commit: null, branch: null },
      }),
    )
    renderWithQuery(<GitCard project="alpha" />)
    expect(await screen.findByText('detached HEAD')).toBeInTheDocument()
  })

  it('calls a clean tree clean', async () => {
    projectGit.mockResolvedValue(
      collected({
        git: { ...collected().git!, staged: 0, unstaged: 0, untracked: 0, unmerged: 0, dirty: false },
      }),
    )
    renderWithQuery(<GitCard project="alpha" />)
    expect(await screen.findByText('clean')).toBeInTheDocument()
  })
})

describe('the GitHub section', () => {
  const forge = (pulls: unknown[], authenticated = true) => ({
    kind: 'github',
    collectedAt: Math.floor(Date.now() / 1000),
    authenticated,
    reason: null,
    pulls,
  })

  it('lists the open pull requests, with review and checks', async () => {
    projectGit.mockResolvedValue(
      collected({
        forge: forge([
          {
            number: 61,
            title: 'Add invoice totals',
            state: 'OPEN',
            draft: false,
            reviewDecision: 'REVIEW_REQUIRED',
            checks: 'passing',
            url: 'https://github.com/owner/repo/pull/61',
            headRefName: 'feature/59',
          },
        ]) as never,
      }),
    )
    renderWithQuery(<GitCard project="alpha" />)

    expect(await screen.findByText('1 open pull request')).toBeInTheDocument()
    expect(screen.getByText(/#61 Add invoice totals/).closest('a')).toHaveAttribute(
      'href',
      'https://github.com/owner/repo/pull/61',
    )
    expect(screen.getByText('review requested')).toBeInTheDocument()
    expect(screen.getByText('checks passing')).toBeInTheDocument()
  })

  it('says there are none rather than hiding the section', async () => {
    projectGit.mockResolvedValue(collected({ forge: forge([]) as never }))
    renderWithQuery(<GitCard project="alpha" />)
    expect(await screen.findByText('No open pull requests')).toBeInTheDocument()
  })

  it('renders nothing when gh could not be asked', async () => {
    projectGit.mockResolvedValue(collected({ forge: forge([], false) as never }))
    renderWithQuery(<GitCard project="alpha" />)
    await screen.findByText('feature/59-invoices')
    expect(screen.queryByText(/pull request/)).toBeNull()
  })

  it('renders nothing when there is no forge block at all', async () => {
    projectGit.mockResolvedValue(collected({ forge: null }))
    renderWithQuery(<GitCard project="alpha" />)
    await screen.findByText('feature/59-invoices')
    expect(screen.queryByText(/pull request/)).toBeNull()
  })

  it('marks a draft, and failing checks', async () => {
    projectGit.mockResolvedValue(
      collected({
        forge: forge([
          {
            number: 62,
            title: 'WIP',
            state: 'OPEN',
            draft: true,
            reviewDecision: null,
            checks: 'failing',
            url: null,
            headRefName: 'wip',
          },
        ]) as never,
      }),
    )
    renderWithQuery(<GitCard project="alpha" />)
    expect(await screen.findByText('draft')).toBeInTheDocument()
    expect(screen.getByText('checks failing')).toBeInTheDocument()
  })
})
