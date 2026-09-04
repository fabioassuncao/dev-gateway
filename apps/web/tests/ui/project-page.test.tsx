import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { renderWithQuery } from './render.tsx'
import { makeEvent, makeRepository, makeSession, makeTaskSummary } from './fixtures.ts'
import type { Project } from 'portta-contracts'

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
const deleteProject = vi.fn()
const patchProject = vi.fn()
const githubRepositories = vi.fn()
const createRepository = vi.fn()
const deleteRepository = vi.fn()
const discoveredRepositories = vi.fn()
const environments = vi.fn()
const tasks = vi.fn()
const nextTask = vi.fn()
const sessions = vi.fn()
const projectActivity = vi.fn()
const metricsCurrent = vi.fn()
const setTaskStatus = vi.fn()
const setProjectEnvironments = vi.fn()

vi.mock('../../src/ui/lib/api/index.ts', () => ({
  ApiError,
  api: {
    project: (slug: string) => project(slug),
    deleteProject: (slug: string) => deleteProject(slug),
    patchProject: (slug: string, body: unknown) => patchProject(slug, body),
    githubRepositories: () => githubRepositories(),
    createRepository: (...args: unknown[]) => createRepository(...args),
    deleteRepository: (id: string) => deleteRepository(id),
    discoveredRepositories: () => discoveredRepositories(),
    environments: () => environments(),
    environmentGit: () => Promise.resolve(null),
    tasks: (slug: string, filters: unknown) => tasks(slug, filters),
    nextTask: (slug: string) => nextTask(slug),
    sessions: (slug: string, filters: unknown) => sessions(slug, filters),
    projectActivity: (slug: string, filters: unknown) => projectActivity(slug, filters),
    metricsCurrent: () => metricsCurrent(),
    setTaskStatus: (id: string, status: string) => setTaskStatus(id, status),
    moveTask: (id: string, body: { status: string }) => setTaskStatus(id, body.status),
    setProjectEnvironments: (slug: string, list: string[]) => setProjectEnvironments(slug, list),
  },
}))

const { ProjectPage } = await import('../../src/ui/pages/Project.tsx')

const detail: Project = {
  id: 'ws-1',
  slug: 'meu-produto',
  name: 'Meu Produto',
  description: 'The thing we sell',
  archived: false,
  relativePath: null,
  resolvedPath: null,
  location: 'external',
  repositories: [makeRepository({ id: 'r1', name: 'web', role: 'web', environments: [], github: { repositoryId: 'gh-1', fullName: 'acme/alpha', htmlUrl: 'https://github.com/acme/alpha', defaultBranch: 'main', private: true, archived: false, role: 'web', position: 0 } })],
  githubRepositories: [],
  environments: [
    { environment: 'alpha', source: 'label', running: true, serviceCount: 2, runningCount: 2, unhealthyCount: 0, urls: [] },
  ],
}

beforeEach(() => {
  project.mockReset().mockResolvedValue(detail)
  deleteProject.mockReset().mockResolvedValue({ ok: true, removed: 'meu-produto', note: '' })
  patchProject.mockReset().mockResolvedValue(detail)
  githubRepositories.mockReset().mockResolvedValue([
    { githubId: 1, fullName: 'acme/alpha', private: true },
    { githubId: 2, fullName: 'acme/api', private: false },
  ])
  createRepository.mockReset().mockResolvedValue(detail.repositories[0])
  deleteRepository.mockReset().mockResolvedValue({ ok: true, removed: 'r1', note: '' })
  discoveredRepositories.mockReset().mockResolvedValue([{ key: 'abcdef012345', path: '/srv/projects/shop/web', name: 'web', remote: null, location: 'managed', relativePath: 'shop/web', environments: ['alpha'] }])
  environments.mockReset().mockResolvedValue([])
  tasks.mockReset().mockResolvedValue([
    makeTaskSummary({ id: '42', project: 'meu-produto', status: 'in_progress', agent: 'claude-code', assignee: null }),
    makeTaskSummary({ id: '7', project: 'meu-produto', title: 'Corrigir fila', status: 'blocked' }),
    makeTaskSummary({ id: '8', project: 'meu-produto', title: 'Escrever docs', status: 'ready' }),
  ])
  nextTask.mockReset().mockResolvedValue(makeTaskSummary({ id: '8', project: 'meu-produto', title: 'Escrever docs', status: 'ready' }))
  sessions.mockReset().mockResolvedValue([makeSession({ project: 'meu-produto' })])
  projectActivity.mockReset().mockResolvedValue({ events: [makeEvent({ project: 'meu-produto' })], nextBefore: null })
  metricsCurrent.mockReset().mockResolvedValue({ version: 1, instance: { id: 'i', name: 'lab', hostname: 'lab' }, collectedAt: null, ageSeconds: null, stale: true, collectorActive: false, host: null, runtime: null, projects: [] })
  setTaskStatus.mockReset().mockResolvedValue({})
  setProjectEnvironments.mockReset().mockResolvedValue(detail)
  window.location.hash = '/projects/meu-produto'
})

describe('the project cockpit', () => {
  it('answers what is being done, by whom, and what is next', async () => {
    renderWithQuery(<ProjectPage slug="meu-produto" />)
    expect(await screen.findByRole('heading', { name: 'Meu Produto' })).toBeInTheDocument()
    expect(await screen.findByRole('group', { name: '#42 Implementar refresh token' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '#7 Corrigir fila' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '#8 Escrever docs' })).toHaveAttribute('href', '#/projects/meu-produto/tasks/8')
    expect(screen.getByRole('group', { name: 'claude session' })).toBeInTheDocument()
    expect(screen.getByText('#42 moved to in progress')).toBeInTheDocument()
  })

  it('sits under Projects in the breadcrumb, with the project as the current item', async () => {
    renderWithQuery(<ProjectPage slug="meu-produto" />)
    await screen.findByRole('heading', { name: 'Meu Produto' })
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(nav).getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '#/projects')
    expect(within(nav).getByText('Meu Produto')).toHaveAttribute('aria-current', 'page')
  })

  it('shows each repository with its branch and links it to its page', async () => {
    renderWithQuery(<ProjectPage slug="meu-produto" />)
    const row = await screen.findByRole('group', { name: 'web repository' })
    expect(within(row).getByRole('link', { name: 'web' })).toHaveAttribute('href', '#/projects/meu-produto/repositories/r1')
    expect(within(row).getByText('main')).toBeInTheDocument()
  })

  it('says why each environment was adopted when the host does not list it', async () => {
    renderWithQuery(<ProjectPage slug="meu-produto" />)
    expect(await screen.findByText('declared by its portta.project label')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'alpha' })).toHaveAttribute('href', '#/environments/alpha')
  })

  it('has every section as a tab that is a URL', async () => {
    renderWithQuery(<ProjectPage slug="meu-produto" />)
    await screen.findByRole('heading', { name: 'Meu Produto' })
    expect(screen.getByRole('tab', { name: 'Tasks' })).toHaveAttribute('href', '#/projects/meu-produto/tasks')
    expect(screen.getByRole('tab', { name: 'Repositories (1)' })).toHaveAttribute('href', '#/projects/meu-produto/repositories')
    expect(screen.getByRole('tab', { name: 'Activity' })).toHaveAttribute('href', '#/projects/meu-produto/activity')
  })

  it('shows the board on the tasks tab, with the filters in the hash', async () => {
    renderWithQuery(<ProjectPage slug="meu-produto" tab="tasks" query="?status=blocked" />)
    expect(await screen.findByRole('region', { name: 'Blocked column' })).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Blocked column' })).getByRole('article', { name: '#7 Corrigir fila' })).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: '#42 Implementar refresh token' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'Table' }))
    await waitFor(() => expect(window.location.hash).toBe('#/projects/meu-produto/tasks?view=table&status=blocked'))
  })

  it('moves a card optimistically and rolls it back visibly when refused', async () => {
    setTaskStatus.mockRejectedValue(new ApiError(403, 'the panel is read-only, so task:write is refused'))
    renderWithQuery(<ProjectPage slug="meu-produto" tab="tasks" />)
    const card = await screen.findByRole('article', { name: '#7 Corrigir fila' })
    await userEvent.click(within(card).getByRole('button', { name: 'Actions for #7' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Move to To do' }))
    expect(await screen.findByText(/read-only/)).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Blocked column' })).getByRole('article', { name: '#7 Corrigir fila' })).toBeInTheDocument()
  })

  it('adds a repository the host scanned from the repositories tab', async () => {
    renderWithQuery(<ProjectPage slug="meu-produto" tab="repositories" />)
    await screen.findByRole('group', { name: 'web repository' })
    await userEvent.click(screen.getByRole('button', { name: /Add repository/ }))
    expect(await screen.findByText('shop/web')).toHaveAttribute('title', '/srv/projects/shop/web')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(createRepository).toHaveBeenCalledWith('meu-produto', { scanKey: 'abcdef012345' }))
  })

  it('unregisters a repository without touching anything else', async () => {
    renderWithQuery(<ProjectPage slug="meu-produto" tab="repositories" />)
    const row = await screen.findByRole('group', { name: 'web repository' })
    await userEvent.click(within(row).getByRole('button', { name: 'Unregister' }))
    await waitFor(() => expect(deleteRepository).toHaveBeenCalledWith('r1'))
  })

  it('deletes the project only after the slug is typed back, and says what stays', async () => {
    renderWithQuery(<ProjectPage slug="meu-produto" tab="settings" />)
    expect(await screen.findByText(/every container, volume, network/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Delete project' }))
    const confirm = screen.getByRole('button', { name: 'Delete project' })
    expect(confirm).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Type meu-produto to confirm'), 'meu-produto')
    await userEvent.click(confirm)
    await waitFor(() => expect(deleteProject).toHaveBeenCalledWith('meu-produto'))
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
  })
})
