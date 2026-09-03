import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderWithQuery } from './render.tsx'
import { makeOverview } from './fixtures.ts'

class ApiError extends Error {
  status: number
  hint: string
  constructor(status: number, message: string, hint = '') {
    super(message)
    this.status = status
    this.hint = hint
  }
}

const developmentOverview = vi.fn()
const overview = vi.fn()
const metricsCurrent = vi.fn()
const metricsHistory = vi.fn()
const environments = vi.fn()

vi.mock('../../src/ui/lib/api/index.ts', () => ({
  ApiError,
  api: {
    developmentOverview: () => developmentOverview(),
    overview: () => overview(),
    metricsCurrent: () => metricsCurrent(),
    metricsHistory: () => metricsHistory(),
    environments: () => environments(),
  },
}))

const { Overview } = await import('../../src/ui/pages/Overview.tsx')

beforeEach(() => {
  developmentOverview.mockReset().mockResolvedValue(makeOverview())
  overview.mockReset().mockResolvedValue({ gateway: { up: true, panel: { readOnly: false, docs: true } }, problems: [{ id: 'p', status: 'warn', title: 'Unhealthy containers', detail: 'x', fix: null }], counts: {}, urls: [] })
  metricsCurrent.mockReset().mockResolvedValue({ version: 1, instance: { id: 'i', name: 'lab', hostname: 'lab' }, collectedAt: null, ageSeconds: null, stale: true, collectorActive: false, host: null, runtime: null, projects: [] })
  metricsHistory.mockReset().mockResolvedValue({ windowSeconds: 1800, points: [] })
  environments.mockReset().mockResolvedValue([])
})

describe('the development dashboard', () => {
  it('answers what is being worked on and by whom', async () => {
    renderWithQuery(<Overview />)
    expect(await screen.findByText('3 open · 1 in progress · 0 in review · 1 blocked')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '#42 Implementar refresh token' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '#7 Corrigir fila' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'claude session' })).toBeInTheDocument()
  })

  it('says what needs attention and links to it', async () => {
    renderWithQuery(<Overview />)
    expect(await screen.findByRole('link', { name: 'produto/worker is unhealthy' })).toHaveAttribute('href', '#/environments/produto?service=worker')
  })

  it('summarises each project and the code that moved', async () => {
    renderWithQuery(<Overview />)
    const project = await screen.findByRole('group', { name: 'Meu Produto' })
    expect(within(project).getByText('3 open · 1 in progress')).toBeInTheDocument()
    expect(within(project).getByText('1 blocked')).toBeInTheDocument()
    expect(screen.getByText('Add totals')).toBeInTheDocument()
    expect(screen.getByText('3 uncommitted')).toBeInTheDocument()
  })

  it('lists who is using the host', async () => {
    renderWithQuery(<Overview />)
    expect(await screen.findByText('Using this host')).toBeInTheDocument()
    for (const link of screen.getAllByRole('link', { name: 'Meu Produto' })) expect(link).toHaveAttribute('href', '#/projects/produto')
  })

  it('falls back to the gateway status when the dashboard needs the database', async () => {
    developmentOverview.mockRejectedValue(new ApiError(503, 'panel persistence is unavailable'))
    renderWithQuery(<Overview />)
    expect(await screen.findByText("The development dashboard needs the panel's database")).toBeInTheDocument()
    expect(screen.getByText('Unhealthy containers')).toBeInTheDocument()
    expect(screen.getByText('Gateway running')).toBeInTheDocument()
  })
})
