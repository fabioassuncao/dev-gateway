import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { renderWithQuery } from './render.tsx'
import type { ApplyStatus } from '../../src/shared/types.ts'

const applyStatus = vi.fn()
const applyProbe = vi.fn()
const healthProbe = vi.fn()
const apply = vi.fn()

class ApiError extends Error {
  status: number
  hint = ''
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

vi.mock('../../src/ui/lib/api.ts', () => ({
  ApiError,
  api: {
    applyStatus: () => applyStatus(),
    applyProbe: (signal: AbortSignal) => applyProbe(signal),
    healthProbe: (signal: AbortSignal) => healthProbe(signal),
    apply: () => apply(),
  },
}))

const { ApplyBar } = await import('../../src/ui/components/apply-bar.tsx')

const IDLE: ApplyStatus = {
  state: 'idle',
  available: true,
  reason: null,
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  pendingRestart: true,
  pendingKeys: ['PORTTA_DOMAIN'],
  movesPanel: false,
  logTail: [],
  profile: 'local',
  applyCommand: './bin/portta up local',
}

const SETTLED: ApplyStatus = { ...IDLE, state: 'ok', pendingRestart: false, pendingKeys: [], exitCode: 0 }

beforeEach(() => {
  applyStatus.mockReset().mockResolvedValue(IDLE)
  applyProbe.mockReset().mockResolvedValue(SETTLED)
  healthProbe.mockReset().mockResolvedValue({ ok: true, panelVersion: '0.1.0', gatewayVersion: '0.3.0' })
  apply.mockReset().mockResolvedValue({ ok: true, startedAt: 1, note: '', applyCommand: './bin/portta up local' })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the pending bar', () => {
  it('says nothing when the running gateway agrees with what is saved', async () => {
    applyStatus.mockResolvedValue({ ...IDLE, pendingRestart: false, pendingKeys: [] })
    renderWithQuery(<ApplyBar readOnly={false} />)
    await waitFor(() => expect(applyStatus).toHaveBeenCalled())
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('offers the button when the host has an applier', async () => {
    renderWithQuery(<ApplyBar readOnly={false} />)
    expect(await screen.findByRole('button', { name: 'Apply and restart' })).toBeInTheDocument()
  })

  it('falls back to the host command when the host has no applier', async () => {
    applyStatus.mockResolvedValue({
      ...IDLE,
      state: 'unavailable',
      available: false,
      reason: 'set PORTTA_APPLY=true on the host, then run the command once',
    })
    renderWithQuery(<ApplyBar readOnly={false} />)
    expect(await screen.findByText('./bin/portta up local')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Apply and restart' })).not.toBeInTheDocument()
  })

  it('offers no button in read-only mode, only the command', async () => {
    renderWithQuery(<ApplyBar readOnly />)
    expect(await screen.findByText('./bin/portta up local')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Apply and restart' })).not.toBeInTheDocument()
  })
})

describe('the confirmation', () => {
  it('names what is pending, and does not apply until confirmed', async () => {
    renderWithQuery(<ApplyBar readOnly={false} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Apply and restart' }))

    expect(screen.getByText('PORTTA_DOMAIN')).toBeInTheDocument()
    expect(screen.getByText(/goes offline for a few seconds/)).toBeInTheDocument()
    expect(screen.getByText(/projects are not touched/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(apply).not.toHaveBeenCalled()
  })

  it('warns when the panel is about to move, because this tab will not come back', async () => {
    applyStatus.mockResolvedValue({ ...IDLE, movesPanel: true, pendingKeys: ['PORTTA_WEB_PORT'] })
    renderWithQuery(<ApplyBar readOnly={false} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Apply and restart' }))
    expect(screen.getByText(/will not reconnect on its own/)).toBeInTheDocument()
  })
})

describe('applying', () => {
  it('cannot be dismissed while it runs', async () => {
    renderWithQuery(<ApplyBar readOnly={false} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Apply and restart' }))
    await userEvent.click(screen.getByRole('button', { name: 'Apply and restart' }))

    await screen.findByText('Do not close this tab. The panel comes back on its own.')
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('treats the panel going away as progress, and reports success when it answers again', async () => {
    // This is the whole point of the dialog: while the gateway is being
    // recreated the panel is unreachable, and a fetch rejection there means
    // "working", not "broken".
    healthProbe
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue({ ok: true, panelVersion: '0.1.0', gatewayVersion: '0.3.0' })

    const user = userEvent.setup()
    renderWithQuery(<ApplyBar readOnly={false} />)
    await user.click(await screen.findByRole('button', { name: 'Apply and restart' }))
    await user.click(screen.getByRole('button', { name: 'Apply and restart' }))

    await waitFor(() => expect(screen.getByText('Panel went offline')).toBeInTheDocument(), { timeout: 8_000 })
    await waitFor(() => expect(screen.getByText(/The saved settings are running/)).toBeInTheDocument(), {
      timeout: 15_000,
    })
  }, 20_000)

  it('shows the exit code and the output when the applier failed', async () => {
    applyProbe.mockResolvedValue({
      ...IDLE,
      state: 'failed',
      exitCode: 2,
      startedAt: 1,
      finishedAt: 2,
      logTail: ['error: could not create the shared network'],
    })

    const user = userEvent.setup()
    renderWithQuery(<ApplyBar readOnly={false} />)
    await user.click(await screen.findByRole('button', { name: 'Apply and restart' }))
    await user.click(screen.getByRole('button', { name: 'Apply and restart' }))

    await waitFor(() => expect(screen.getByText(/exited with code 2/)).toBeInTheDocument(), { timeout: 8_000 })
    await user.click(screen.getByText('Show output'))
    expect(screen.getByText(/could not create the shared network/)).toBeInTheDocument()
  }, 15_000)
})

describe('an apply that was already running', () => {
  it('reopens the progress dialog, counting from the host clock', async () => {
    // A reload mid-apply, or a second tab. The state is the applier's, so this
    // needs no memory in the browser.
    const startedAt = Math.floor(Date.now() / 1000) - 42
    applyStatus.mockResolvedValue({ ...IDLE, state: 'running', startedAt })
    applyProbe.mockResolvedValue({ ...IDLE, state: 'running', startedAt })

    renderWithQuery(<ApplyBar readOnly={false} />)
    await screen.findByText('Do not close this tab. The panel comes back on its own.')
    expect(await screen.findByText(/^0[01]:4[0-9]$/)).toBeInTheDocument()
    expect(apply).not.toHaveBeenCalled()
  })
})
