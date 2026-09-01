import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithQuery } from './render.tsx'

const overview = vi.fn()
const useLive = vi.fn()

vi.mock('../../src/ui/lib/api.ts', () => ({
  api: { overview: () => overview() },
}))

vi.mock('../../src/ui/lib/live.ts', () => ({
  useLive: () => useLive(),
}))

vi.mock('../../src/ui/pages/Overview.tsx', () => ({
  Overview: () => <h1>Overview</h1>,
}))

const { App } = await import('../../src/ui/App.tsx')

beforeEach(() => {
  localStorage.clear()
  window.location.hash = '/overview'
  useLive.mockReturnValue({ state: 'live' })
  overview.mockReset().mockResolvedValue({
    gateway: {
      up: true,
      gatewayVersion: '0.1.0',
      profile: 'local',
      panel: { expose: 'local', routed: false, auth: 'none', authenticated: false, user: '', readOnly: false },
    },
  })
})

describe('connection banner', () => {
  it('is hidden while live updates are connected', async () => {
    renderWithQuery(<App />)
    await waitFor(() => expect(overview).toHaveBeenCalled())

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows when live updates are offline', async () => {
    useLive.mockReturnValue({ state: 'offline' })
    renderWithQuery(<App />)
    await waitFor(() => expect(overview).toHaveBeenCalled())

    expect(screen.getByRole('status')).toHaveTextContent("Can't reach the panel. Live updates are paused.")
  })
})
