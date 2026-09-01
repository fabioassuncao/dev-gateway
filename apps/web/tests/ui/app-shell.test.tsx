import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { renderWithQuery } from './render.tsx'

const overview = vi.fn()

vi.mock('../../src/ui/lib/api.ts', () => ({
  api: { overview: () => overview() },
}))

vi.mock('../../src/ui/lib/live.ts', () => ({
  useLive: () => ({ state: 'live' }),
}))

vi.mock('../../src/ui/pages/Overview.tsx', () => ({
  Overview: () => <h1>Overview</h1>,
}))

const { App } = await import('../../src/ui/App.tsx')

beforeEach(() => {
  localStorage.clear()
  window.location.hash = '/overview'
  overview.mockReset().mockResolvedValue({
    gateway: {
      up: true,
      gatewayVersion: '0.1.0',
      profile: 'local',
      panel: { expose: 'local', routed: false, auth: 'none', authenticated: false, user: '', readOnly: false },
    },
  })
})

describe('the application shell', () => {
  it('keeps collapsed navigation named and marks the current section', async () => {
    renderWithQuery(<App />)
    await waitFor(() => expect(overview).toHaveBeenCalled())

    await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))

    expect(screen.getByRole('complementary')).toHaveAttribute('data-collapsed', 'true')
    expect(screen.getByRole('button', { name: 'Projects' })).toHaveAttribute('title', 'Projects')
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-expanded', 'false')
    expect(localStorage.getItem('dg-sidebar')).toBe('collapsed')
  })
})
