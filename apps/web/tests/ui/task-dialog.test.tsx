import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { renderWithQuery } from './render.tsx'
import { makeTask } from './fixtures.ts'

const createTask = vi.fn()
const navigate = vi.fn()

vi.mock('@/lib/api/index', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    createTask: (slug: string, body: unknown) => createTask(slug, body),
  },
}))

vi.mock('@/lib/navigation', () => ({
  navigate: (path: string) => navigate(path),
}))

const { useKickCreate } = await import('@/lib/kick-create')

function Probe({ parentId }: { parentId?: string }) {
  const kick = useKickCreate('produto')
  return <button type="button" onClick={() => kick.mutate(parentId ? { parentId } : {})}>New task</button>
}

beforeEach(() => {
  createTask.mockReset().mockResolvedValue(makeTask({ id: '9', draft: true, title: 'New task' }))
  navigate.mockReset()
})

describe('kick-create', () => {
  it('creates a draft and opens its page', async () => {
    renderWithQuery(<Probe />)
    await userEvent.click(screen.getByRole('button', { name: 'New task' }))
    await waitFor(() => expect(createTask).toHaveBeenCalledWith('produto', expect.objectContaining({ title: 'New task', draft: true })))
    expect(navigate).toHaveBeenCalledWith('/projects/produto/tasks/9')
  })

  it('creates a draft under its parent', async () => {
    renderWithQuery(<Probe parentId="42" />)
    await userEvent.click(screen.getByRole('button', { name: 'New task' }))
    await waitFor(() => expect(createTask.mock.calls[0]![1]).toMatchObject({ parentId: '42', draft: true }))
  })
})
