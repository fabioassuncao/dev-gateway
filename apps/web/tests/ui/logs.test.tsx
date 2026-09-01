import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { renderWithQuery } from './render.tsx'
import { LogViewer } from '../../src/ui/components/logs.tsx'
import type { LogsResponse } from '../../src/shared/types.ts'

const response: LogsResponse = {
  containerId: 'c1',
  name: 'alpha-web-1',
  truncated: false,
  lines: [
    { stream: 'stdout', timestamp: '2026-01-01T10:00:01Z', text: 'listening on 3000' },
    { stream: 'stderr', timestamp: '2026-01-01T10:00:02Z', text: 'connection refused' },
    { stream: 'stdout', timestamp: '2026-01-01T10:00:03Z', text: 'retrying' },
  ],
}

describe('the log viewer', () => {
  it('shows recent lines with their time', async () => {
    renderWithQuery(<LogViewer queryKey={['x']} load={() => Promise.resolve(response)} />)
    expect(await screen.findByText('listening on 3000')).toBeInTheDocument()
    expect(screen.getAllByText('10:00:01')).toHaveLength(1)
    expect(screen.getByText('3 lines')).toBeInTheDocument()
  })

  it('filters as you type', async () => {
    renderWithQuery(<LogViewer queryKey={['x']} load={() => Promise.resolve(response)} />)
    await screen.findByText('listening on 3000')

    await userEvent.type(screen.getByLabelText('Filter log lines'), 'refused')
    await waitFor(() => expect(screen.queryByText('listening on 3000')).not.toBeInTheDocument())
    expect(screen.getByText('connection refused')).toBeInTheDocument()
    expect(screen.getByText('1 lines')).toBeInTheDocument()
  })

  it('says when a filter matches nothing', async () => {
    renderWithQuery(<LogViewer queryKey={['x']} load={() => Promise.resolve(response)} />)
    await screen.findByText('retrying')
    await userEvent.type(screen.getByLabelText('Filter log lines'), 'zzz')
    expect(await screen.findByText('No line matches the filter')).toBeInTheDocument()
  })

  it('copies what is on screen, not what was filtered out', async () => {
    renderWithQuery(<LogViewer queryKey={['x']} load={() => Promise.resolve(response)} />)
    await screen.findByText('retrying')

    await userEvent.type(screen.getByLabelText('Filter log lines'), 'retry')
    await userEvent.click(screen.getByRole('button', { name: 'Copy log' }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('retrying')
  })

  it('asks for more lines when told to', async () => {
    const load = vi.fn().mockResolvedValue(response)
    renderWithQuery(<LogViewer queryKey={['x']} load={load} />)
    await screen.findByText('retrying')
    expect(load).toHaveBeenCalledWith(200)

    await userEvent.selectOptions(screen.getByLabelText('Number of lines'), '1000')
    await waitFor(() => expect(load).toHaveBeenCalledWith(1000))
  })

  it('reports a failure instead of showing an empty pane', async () => {
    renderWithQuery(
      <LogViewer queryKey={['x']} load={() => Promise.reject(new Error('could not read logs'))} />,
    )
    expect(await screen.findByText('could not read logs')).toBeInTheDocument()
  })

  it('says nothing has been logged yet', async () => {
    renderWithQuery(
      <LogViewer queryKey={['x']} load={() => Promise.resolve({ ...response, lines: [] })} />,
    )
    expect(await screen.findByText('No output yet')).toBeInTheDocument()
  })
})
