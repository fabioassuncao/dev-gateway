import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { renderWithQuery } from './render.tsx'
import { makeTask, makeTaskSummary } from './fixtures.ts'
import type { ProjectSummary } from '../../src/shared/types.ts'

class ApiError extends Error {
  status: number
  hint: string
  constructor(status: number, message: string, hint = '') {
    super(message)
    this.status = status
    this.hint = hint
  }
}

const allTasks = vi.fn()
const projects = vi.fn()
const project = vi.fn()
const createTask = vi.fn()
const moveTask = vi.fn()
const navigate = vi.fn()

vi.mock('../../src/ui/lib/api/index.ts', () => ({
  ApiError,
  api: {
    allTasks: (filters: unknown) => allTasks(filters),
    projects: () => projects(),
    project: (slug: string) => project(slug),
    createTask: (slug: string, body: unknown) => createTask(slug, body),
    moveTask: (id: string, body: unknown) => moveTask(id, body),
  },
}))

vi.mock('../../src/ui/lib/router.ts', () => ({
  navigate: (path: string) => navigate(path),
}))

const { Tasks } = await import('../../src/ui/pages/Tasks.tsx')

const catalog: ProjectSummary[] = [
  {
    id: '1',
    slug: 'portta',
    name: 'Portta',
    description: null,
    archived: false,
    relativePath: null,
    location: 'managed',
    repositoryCount: 1,
    environmentCount: 1,
    runningEnvironmentCount: 1,
    environments: [{ name: 'portta', running: true, serviceCount: 1, runningCount: 1, unhealthyCount: 0 }],
  },
  {
    id: '2',
    slug: 'shop',
    name: 'Demo Shop',
    description: null,
    archived: false,
    relativePath: null,
    location: 'external',
    repositoryCount: 1,
    environmentCount: 0,
    runningEnvironmentCount: 0,
    environments: [],
  },
]

beforeEach(() => {
  sessionStorage.clear()
  navigate.mockReset()
  allTasks.mockReset().mockResolvedValue([
    makeTaskSummary({ id: '10', project: 'portta', title: 'Fix gateway', status: 'in_progress' }),
    makeTaskSummary({ id: '11', project: 'shop', title: 'Add cart', status: 'ready' }),
  ])
  projects.mockReset().mockResolvedValue(catalog)
  project.mockReset().mockResolvedValue({
    id: '1',
    slug: 'portta',
    name: 'Portta',
    description: null,
    archived: false,
    relativePath: null,
    resolvedPath: null,
    location: 'managed',
    repositories: [],
    githubRepositories: [],
    environments: [],
  })
  createTask.mockReset().mockResolvedValue(makeTask({ id: '99', project: 'portta', draft: true, title: 'New task' }))
  moveTask.mockReset().mockResolvedValue({})
})

describe('the global tasks page', () => {
  it('shows tasks from every project and names the project on each card', async () => {
    renderWithQuery(<Tasks />)
    expect(await screen.findByRole('article', { name: '#10 Fix gateway' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Tasks' })).toBeInTheDocument()
    expect(screen.getByRole('article', { name: '#11 Add cart' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Portta' })).toHaveAttribute('href', '#/projects/portta')
    expect(screen.getByRole('link', { name: 'Demo Shop' })).toHaveAttribute('href', '#/projects/shop')
    expect(screen.getByRole('link', { name: 'Fix gateway' })).toHaveAttribute('href', '#/projects/portta/tasks/10?from=tasks')
  })

  it('keeps a project filter in the hash', async () => {
    renderWithQuery(<Tasks />)
    await screen.findByRole('article', { name: '#10 Fix gateway' })
    await userEvent.selectOptions(screen.getByLabelText('Project'), 'portta')
    expect(navigate).toHaveBeenCalledWith('/tasks?project=portta')
  })

  it('asks which project a new task belongs to, then opens it', async () => {
    renderWithQuery(<Tasks query="?project=portta" />)
    await screen.findByRole('heading', { name: 'Tasks' })
    await userEvent.click(screen.getByRole('button', { name: 'New task' }))
    const dialog = await screen.findByRole('dialog', { name: 'Choose a project' })
    expect(within(dialog).getByLabelText('Project')).toHaveValue('portta')
    await userEvent.click(within(dialog).getByRole('button', { name: 'New task' }))
    await waitFor(() => expect(createTask).toHaveBeenCalledWith('portta', expect.objectContaining({ draft: true })))
    expect(navigate).toHaveBeenCalledWith('/projects/portta/tasks/99?from=tasks')
  })
})
