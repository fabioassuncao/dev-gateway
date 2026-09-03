import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { renderWithQuery } from './render.tsx'
import { makeRepository, makeRepositoryGit } from './fixtures.ts'

class ApiError extends Error {
  status: number
  hint: string
  constructor(status: number, message: string, hint = '') {
    super(message)
    this.status = status
    this.hint = hint
  }
}

const repository = vi.fn()
const repositoryGit = vi.fn()
const repositoryCommits = vi.fn()
const repositoryInstructions = vi.fn()
const repositoryEnvironments = vi.fn()
const deleteRepository = vi.fn()

vi.mock('../../src/ui/lib/api/index.ts', () => ({
  ApiError,
  api: {
    repository: (id: string) => repository(id),
    repositoryGit: (id: string) => repositoryGit(id),
    repositoryCommits: (id: string) => repositoryCommits(id),
    repositoryInstructions: (id: string) => repositoryInstructions(id),
    repositoryEnvironments: (id: string) => repositoryEnvironments(id),
    deleteRepository: (id: string) => deleteRepository(id),
  },
}))

const { RepositoryPage, resolveRepositoryTab } = await import('../../src/ui/pages/Repository.tsx')

beforeEach(() => {
  const git = makeRepositoryGit()
  repository.mockReset().mockResolvedValue(makeRepository())
  repositoryGit.mockReset().mockResolvedValue(git)
  repositoryCommits.mockReset().mockResolvedValue({ commits: git.commits, collectedAt: git.collectedAt, stale: false })
  repositoryInstructions.mockReset().mockResolvedValue({ instructions: git.instructions, collectedAt: git.collectedAt, stale: false })
  repositoryEnvironments.mockReset().mockResolvedValue([{ environment: 'alpha', running: true, serviceCount: 2, runningCount: 2, unhealthyCount: 0, urls: [{ url: 'http://alpha-web.localhost', host: 'alpha-web.localhost', scope: 'local', scheme: 'http' }] }])
  deleteRepository.mockReset().mockResolvedValue({ ok: true, removed: 'r1', note: '' })
  window.location.hash = '/projects/shop/repositories/r1'
})

describe('the Repository page', () => {
  it('resolves its tabs', () => {
    expect(resolveRepositoryTab(null)).toBe('overview')
    expect(resolveRepositoryTab('commits')).toBe('commits')
    expect(resolveRepositoryTab('git')).toBe('overview')
  })

  it('shows what is checked out, the pull requests and the environments', async () => {
    renderWithQuery(<RepositoryPage slug="shop" id="r1" tab={null} />)
    expect(await screen.findByRole('heading', { name: 'api' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'main' })).toHaveAttribute('href', 'https://github.com/acme/api/tree/main')
    expect(screen.getByText('7 uncommitted changes')).toBeInTheDocument()
    expect(screen.getByText('./bin/portta repos scan --path /srv/projects/shop/api')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: '#61 Add invoice totals' })).toHaveAttribute('href', 'https://github.com/acme/api/pull/61')
    expect(screen.getByText('review requested')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'alpha' })).toHaveAttribute('href', '#/environments/alpha')
    expect(screen.getByText('AGENTS.md')).toBeInTheDocument()
  })

  it('lists the recent commits with the sha linked', async () => {
    renderWithQuery(<RepositoryPage slug="shop" id="r1" tab="commits" />)
    expect(await screen.findByText('Add invoice totals')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '9f2c1ab' })).toHaveAttribute('href', 'https://github.com/acme/api/commit/9f2c1abfeed')
    expect(screen.getByText('Start invoices')).toBeInTheDocument()
  })

  it('shows the instruction files and the content of the selected one', async () => {
    renderWithQuery(<RepositoryPage slug="shop" id="r1" tab="instructions" />)
    expect(await screen.findByLabelText('AGENTS.md')).toHaveTextContent('Never prune.')
    expect(screen.getByText('uncommitted')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /style\.mdc/ }))
    expect(await screen.findByText(/over the collection bound/)).toBeInTheDocument()
  })

  it('makes every tab a link under the project', async () => {
    renderWithQuery(<RepositoryPage slug="shop" id="r1" tab={null} />)
    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map((tab) => tab.getAttribute('href'))).toEqual([
      '#/projects/shop/repositories/r1/overview',
      '#/projects/shop/repositories/r1/commits',
      '#/projects/shop/repositories/r1/instructions',
    ])
  })

  it('says when the host has not scanned it yet', async () => {
    repositoryGit.mockResolvedValue(makeRepositoryGit({ collected: false, git: null, remote: null, forge: null, commits: [], instructions: [] }))
    renderWithQuery(<RepositoryPage slug="shop" id="r1" tab={null} />)
    expect(await screen.findByText(/has not been scanned yet/)).toBeInTheDocument()
  })

  it('unregisters after a confirmation and goes back to the project', async () => {
    renderWithQuery(<RepositoryPage slug="shop" id="r1" tab={null} />)
    await screen.findByRole('heading', { name: 'api' })
    await userEvent.click(screen.getByRole('button', { name: 'Unregister' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Unregister' }))
    await waitFor(() => expect(deleteRepository).toHaveBeenCalledWith('r1'))
    await waitFor(() => expect(window.location.hash).toBe('#/projects/shop'))
  })

  it('reports a repository that does not exist with a way back', async () => {
    repository.mockRejectedValue(new ApiError(404, "no repository 'nope'"))
    renderWithQuery(<RepositoryPage slug="shop" id="nope" tab={null} />)
    expect(await screen.findByText("No repository 'nope'")).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to the project' })).toHaveAttribute('href', '#/projects/shop')
  })
})
