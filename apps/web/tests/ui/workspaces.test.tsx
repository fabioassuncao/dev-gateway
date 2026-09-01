import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { renderWithQuery } from './render.tsx'
import type { Workspace, WorkspaceSummary } from '../../src/shared/types.ts'

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

const workspaces = vi.fn()
const workspace = vi.fn()
const createWorkspace = vi.fn()
const deleteWorkspace = vi.fn()
const githubRepositories = vi.fn()
const setWorkspaceRepositories = vi.fn()

vi.mock('../../src/ui/lib/api.ts', () => ({
  ApiError,
  api: {
    workspaces: () => workspaces(),
    workspace: (slug: string) => workspace(slug),
    createWorkspace: (body: unknown) => createWorkspace(body),
    deleteWorkspace: (slug: string) => deleteWorkspace(slug),
    githubRepositories: () => githubRepositories(),
    setWorkspaceRepositories: (...args: unknown[]) => setWorkspaceRepositories(...args),
  },
}))

const { Workspaces } = await import('../../src/ui/pages/Workspaces.tsx')
const { WorkspacePage } = await import('../../src/ui/pages/Workspace.tsx')

const summary: WorkspaceSummary = {
  slug: 'meu-produto',
  name: 'Meu Produto',
  description: 'The thing we sell',
  archived: false,
  repositoryCount: 2,
  environmentCount: 2,
  runningEnvironmentCount: 1,
}

const detail: Workspace = {
  slug: 'meu-produto',
  name: 'Meu Produto',
  description: 'The thing we sell',
  archived: false,
  repositories: [
    {
      repositoryId: 'r1', fullName: 'acme/alpha', htmlUrl: 'https://github.com/acme/alpha',
      defaultBranch: 'main', private: true, archived: false, role: 'web', position: 0,
    },
  ],
  environments: [
    {
      project: 'alpha', source: 'label', running: true,
      serviceCount: 2, runningCount: 2, unhealthyCount: 0, urls: [],
    },
  ],
}

beforeEach(() => {
  workspaces.mockReset().mockResolvedValue([summary])
  workspace.mockReset().mockResolvedValue(detail)
  createWorkspace.mockReset().mockResolvedValue(detail)
  deleteWorkspace.mockReset().mockResolvedValue({ ok: true, removed: 'meu-produto', note: '' })
  githubRepositories.mockReset().mockResolvedValue([
    { githubId: 1, fullName: 'acme/alpha', private: true },
    { githubId: 2, fullName: 'acme/api', private: false },
  ])
  setWorkspaceRepositories.mockReset().mockResolvedValue(detail)
  window.location.hash = '/workspaces'
})

describe('the workspace list', () => {
  it('shows what each workspace owns and how much of it is up', async () => {
    renderWithQuery(<Workspaces />)
    expect(await screen.findByRole('link', { name: 'Meu Produto' })).toHaveAttribute(
      'href',
      '#/workspaces/meu-produto',
    )
    expect(screen.getByText('2 repositories')).toBeInTheDocument()
    expect(screen.getByText('1/2 running')).toBeInTheDocument()
  })

  it('explains what a workspace is when there is none', async () => {
    workspaces.mockResolvedValue([])
    renderWithQuery(<Workspaces />)
    expect(await screen.findByText('No workspace yet')).toBeInTheDocument()
  })

  it('says the database is needed rather than showing a stack', async () => {
    workspaces.mockRejectedValue(new ApiError(503, 'panel persistence is unavailable'))
    renderWithQuery(<Workspaces />)
    expect(await screen.findByText("Workspaces need the panel's database")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /New workspace/ })).toBeDisabled()
  })

  it('derives a slug from the name when none is typed', async () => {
    renderWithQuery(<Workspaces />)
    await screen.findByRole('link', { name: 'Meu Produto' })

    await userEvent.click(screen.getByRole('button', { name: /New workspace/ }))
    await userEvent.type(screen.getByLabelText('Name'), 'Meu Produto')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(createWorkspace).toHaveBeenCalled())
    expect(createWorkspace.mock.calls[0]![0]).toMatchObject({ name: 'Meu Produto', slug: 'meu-produto' })
  })
})

describe('one workspace', () => {
  it('says why each environment was adopted', async () => {
    renderWithQuery(<WorkspacePage slug="meu-produto" />)
    expect(await screen.findByText('declared by its portta.project label')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'alpha' })).toHaveAttribute('href', '#/projects/alpha')
  })

  it('links each repository to GitHub', async () => {
    renderWithQuery(<WorkspacePage slug="meu-produto" />)
    const link = await screen.findByRole('link', { name: /acme\/alpha/ })
    expect(link).toHaveAttribute('href', 'https://github.com/acme/alpha')
  })

  it('renders a workspace with nothing running as a full answer', async () => {
    workspace.mockResolvedValue({ ...detail, environments: [] })
    renderWithQuery(<WorkspacePage slug="meu-produto" />)
    expect(await screen.findByText('Nothing is running for this workspace')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /acme\/alpha/ })).toBeInTheDocument()
  })

  it('reports a workspace that does not exist with a way back', async () => {
    workspace.mockRejectedValue(new ApiError(404, "no workspace 'ghost'"))
    renderWithQuery(<WorkspacePage slug="ghost" />)
    expect(await screen.findByText("No workspace 'ghost'")).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to all workspaces' })).toBeInTheDocument()
  })

  it('offers only repositories the installation granted', async () => {
    renderWithQuery(<WorkspacePage slug="meu-produto" />)
    await screen.findByRole('link', { name: /acme\/alpha/ })

    await userEvent.click(screen.getByRole('button', { name: /Repositories/ }))
    expect(await screen.findByText('acme/api')).toBeInTheDocument()
    expect(screen.getByText(/Only repositories the GitHub App installation granted/)).toBeInTheDocument()
  })

  it('points at Settings when nothing has been granted yet', async () => {
    githubRepositories.mockResolvedValue([])
    renderWithQuery(<WorkspacePage slug="meu-produto" />)
    await screen.findByRole('link', { name: /acme\/alpha/ })

    await userEvent.click(screen.getByRole('button', { name: /Repositories/ }))
    expect(await screen.findByText('No repository has been granted yet')).toBeInTheDocument()
  })

  it('stays usable when GitHub is not configured at all', async () => {
    githubRepositories.mockRejectedValue(new ApiError(503, 'panel persistence is unavailable'))
    renderWithQuery(<WorkspacePage slug="meu-produto" />)
    await screen.findByRole('link', { name: /acme\/alpha/ })

    await userEvent.click(screen.getByRole('button', { name: /Repositories/ }))
    expect(await screen.findByText('The projection is unavailable')).toBeInTheDocument()
  })
})
