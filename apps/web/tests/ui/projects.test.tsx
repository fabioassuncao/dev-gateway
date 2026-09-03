import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { renderWithQuery } from './render.tsx'
import { makeOverview, makePulse } from './fixtures.ts'

class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const projects = vi.fn()
const environments = vi.fn()
const developmentOverview = vi.fn()

vi.mock('../../src/ui/lib/api/index.ts', () => ({
  ApiError,
  api: {
    projects: () => projects(),
    environments: () => environments(),
    developmentOverview: () => developmentOverview(),
  },
}))

const { Projects } = await import('../../src/ui/pages/Projects.tsx')

const summary = { id: 'ws-1', slug: 'produto', name: 'Meu Produto', description: 'The thing we sell', archived: false, relativePath: null, location: 'external', repositoryCount: 2, environmentCount: 1, runningEnvironmentCount: 1 }

beforeEach(() => {
  projects.mockReset().mockResolvedValue([summary])
  environments.mockReset().mockResolvedValue([{ name: 'alpha' }, { name: 'beta' }])
  developmentOverview.mockReset().mockResolvedValue(makeOverview({ projects: [makePulse()] }))
  localStorage.removeItem('portta-projects-density')
})

describe('the Projects page', () => {
  it('is the catalog with a pulse per product, and points at the environments as a count', async () => {
    renderWithQuery(<Projects />)
    expect(await screen.findByRole('link', { name: 'Meu Produto' })).toHaveAttribute('href', '#/projects/produto')
    expect(await screen.findByText('3 open · 1 in progress')).toBeInTheDocument()
    expect(screen.getByText('1 active')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Environments on this host (2)' })).toHaveAttribute('href', '#/environments')
  })

  it('still lists what a project owns when the dashboard is unavailable', async () => {
    developmentOverview.mockRejectedValue(new ApiError(503, 'unavailable'))
    renderWithQuery(<Projects />)
    expect(await screen.findByText('2 repositories')).toBeInTheDocument()
    expect(screen.getByText('1/1 running')).toBeInTheDocument()
  })

  it('switches to rows and remembers it', async () => {
    renderWithQuery(<Projects />)
    await screen.findByRole('link', { name: 'Meu Produto' })
    await userEvent.click(screen.getByRole('button', { name: 'Rows' }))
    expect(within(screen.getByRole('group', { name: 'Meu Produto' })).getByRole('link', { name: 'Meu Produto' })).toBeInTheDocument()
    expect(localStorage.getItem('portta-projects-density')).toBe('rows')
  })
})
