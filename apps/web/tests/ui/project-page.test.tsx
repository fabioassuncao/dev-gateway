import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { renderWithQuery } from './render.tsx'
import type { Project, ProjectSummary } from '../../src/shared/types.ts'

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

const projects = vi.fn()
const project = vi.fn()
const createProject = vi.fn()
const deleteProject = vi.fn()
const githubRepositories = vi.fn()
const setProjectRepositories = vi.fn()
const environments = vi.fn()

vi.mock('../../src/ui/lib/api.ts', () => ({
  ApiError,
  api: {
    projects: () => projects(),
    project: (slug: string) => project(slug),
    createProject: (body: unknown) => createProject(body),
    deleteProject: (slug: string) => deleteProject(slug),
    githubRepositories: () => githubRepositories(),
    setProjectRepositories: (...args: unknown[]) => setProjectRepositories(...args),
    environments: () => environments(),
    projectIssues: () => Promise.resolve([]),
  },
}))

const { Projects } = await import('../../src/ui/pages/Projects.tsx')
const { ProjectPage } = await import('../../src/ui/pages/Project.tsx')

const summary: ProjectSummary = {
  id: 'ws-1',
  slug: 'meu-produto',
  name: 'Meu Produto',
  description: 'The thing we sell',
  archived: false,
  relativePath: null,
  location: 'external',
  repositoryCount: 2,
  environmentCount: 2,
  runningEnvironmentCount: 1,
}

const detail: Project = {
  id: 'ws-1',
  slug: 'meu-produto',
  name: 'Meu Produto',
  description: 'The thing we sell',
  archived: false,
  relativePath: null,
  resolvedPath: null,
  location: 'external',
  repositories: [],
  githubRepositories: [
    {
      repositoryId: 'r1', fullName: 'acme/alpha', htmlUrl: 'https://github.com/acme/alpha',
      defaultBranch: 'main', private: true, archived: false, role: 'web', position: 0,
    },
  ],
  environments: [
    {
      environment: 'alpha', source: 'label', running: true,
      serviceCount: 2, runningCount: 2, unhealthyCount: 0, urls: [],
    },
  ],
}

beforeEach(() => {
  projects.mockReset().mockResolvedValue([summary])
  project.mockReset().mockResolvedValue(detail)
  createProject.mockReset().mockResolvedValue(detail)
  deleteProject.mockReset().mockResolvedValue({ ok: true, removed: 'meu-produto', note: '' })
  githubRepositories.mockReset().mockResolvedValue([
    { githubId: 1, fullName: 'acme/alpha', private: true },
    { githubId: 2, fullName: 'acme/api', private: false },
  ])
  setProjectRepositories.mockReset().mockResolvedValue(detail)
  environments.mockReset().mockResolvedValue([])
  window.location.hash = '/projects'
})

describe('the project list', () => {
  it('shows what each project owns and how much of it is up', async () => {
    renderWithQuery(<Projects />)
    expect(await screen.findByRole('link', { name: 'Meu Produto' })).toHaveAttribute(
      'href',
      '#/projects/meu-produto',
    )
    expect(screen.getByText('2 repositories')).toBeInTheDocument()
    expect(screen.getByText('1/2 running')).toBeInTheDocument()
  })

  it('explains what a project is when there is none', async () => {
    projects.mockResolvedValue([])
    renderWithQuery(<Projects />)
    expect(await screen.findByText('No project yet')).toBeInTheDocument()
  })

  it('says the database is needed rather than showing a stack', async () => {
    projects.mockRejectedValue(new ApiError(503, 'panel persistence is unavailable'))
    renderWithQuery(<Projects />)
    expect(await screen.findByText("Projects need the panel's database")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /New project/ })).toBeDisabled()
  })

  it('derives a slug from the name when none is typed', async () => {
    renderWithQuery(<Projects />)
    await screen.findByRole('link', { name: 'Meu Produto' })

    await userEvent.click(screen.getByRole('button', { name: /New project/ }))
    await userEvent.type(screen.getByLabelText('Name'), 'Meu Produto')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(createProject).toHaveBeenCalled())
    expect(createProject.mock.calls[0]![0]).toMatchObject({ name: 'Meu Produto', slug: 'meu-produto' })
  })
})

describe('one project', () => {
  it('says why each environment was adopted', async () => {
    renderWithQuery(<ProjectPage slug="meu-produto" />)
    expect(await screen.findByText('declared by its portta.project label')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'alpha' })).toHaveAttribute('href', '#/environments/alpha')
  })

  it('links each repository to GitHub', async () => {
    renderWithQuery(<ProjectPage slug="meu-produto" />)
    const link = await screen.findByRole('link', { name: /acme\/alpha/ })
    expect(link).toHaveAttribute('href', 'https://github.com/acme/alpha')
  })

  it('renders a project with nothing running as a full answer', async () => {
    project.mockResolvedValue({ ...detail, environments: [] })
    renderWithQuery(<ProjectPage slug="meu-produto" />)
    expect(await screen.findByText('Nothing is running for this project')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /acme\/alpha/ })).toBeInTheDocument()
  })

  it('opens the board under the project', async () => {
    renderWithQuery(<ProjectPage slug="meu-produto" />)
    await screen.findByRole('link', { name: /acme\/alpha/ })
    await userEvent.click(screen.getByRole('button', { name: 'Board' }))
    await waitFor(() => expect(window.location.hash).toBe('#/projects/meu-produto/board'))
  })

  it('sends an old environment bookmark to the environment page', async () => {
    project.mockRejectedValue(new ApiError(404, "no project 'alpha'"))
    renderWithQuery(<ProjectPage slug="alpha" tab="logs" />)
    await waitFor(() => expect(window.location.hash).toBe('#/environments/alpha/logs'))
  })

  it('says the database is needed instead of redirecting', async () => {
    project.mockRejectedValue(new ApiError(503, 'panel persistence is unavailable'))
    renderWithQuery(<ProjectPage slug="meu-produto" />)
    expect(await screen.findByText("Projects need the panel's database")).toBeInTheDocument()
    expect(window.location.hash).toBe('#/projects')
  })

  it('offers only repositories the installation granted', async () => {
    renderWithQuery(<ProjectPage slug="meu-produto" />)
    await screen.findByRole('link', { name: /acme\/alpha/ })

    await userEvent.click(screen.getByRole('button', { name: /Repositories/ }))
    expect(await screen.findByText('acme/api')).toBeInTheDocument()
    expect(screen.getByText(/Only repositories the GitHub App installation granted/)).toBeInTheDocument()
  })

  it('points at Settings when nothing has been granted yet', async () => {
    githubRepositories.mockResolvedValue([])
    renderWithQuery(<ProjectPage slug="meu-produto" />)
    await screen.findByRole('link', { name: /acme\/alpha/ })

    await userEvent.click(screen.getByRole('button', { name: /Repositories/ }))
    expect(await screen.findByText('No repository has been granted yet')).toBeInTheDocument()
  })

  it('stays usable when GitHub is not configured at all', async () => {
    githubRepositories.mockRejectedValue(new ApiError(503, 'panel persistence is unavailable'))
    renderWithQuery(<ProjectPage slug="meu-produto" />)
    await screen.findByRole('link', { name: /acme\/alpha/ })

    await userEvent.click(screen.getByRole('button', { name: /Repositories/ }))
    expect(await screen.findByText('The projection is unavailable')).toBeInTheDocument()
  })
})
