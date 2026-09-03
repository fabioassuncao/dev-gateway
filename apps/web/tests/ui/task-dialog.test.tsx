import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { renderWithQuery } from './render.tsx'
import { makeTask } from './fixtures.ts'

const createTask = vi.fn()
const patchTask = vi.fn()

vi.mock('../../src/ui/lib/api/index.ts', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    createTask: (slug: string, body: unknown) => createTask(slug, body),
    patchTask: (id: string, body: unknown) => patchTask(id, body),
  },
}))

const { TaskDialog } = await import('../../src/ui/components/tasks/task-dialog.tsx')

beforeEach(() => {
  createTask.mockReset().mockResolvedValue(makeTask({ id: '9' }))
  patchTask.mockReset().mockResolvedValue(makeTask())
})

describe('the task dialog', () => {
  it('creates a local task with what was typed, and nothing GitHub', async () => {
    const onSaved = vi.fn()
    renderWithQuery(<TaskDialog mode="create" slug="produto" open onOpenChange={() => {}} onSaved={onSaved} />)
    await userEvent.type(screen.getByLabelText('Title'), 'Corrigir autenticação')
    await userEvent.selectOptions(screen.getByLabelText('Priority'), 'high')
    await userEvent.type(screen.getByLabelText('Labels'), 'area:api, auth')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(createTask).toHaveBeenCalled())
    expect(createTask.mock.calls[0]![0]).toBe('produto')
    expect(createTask.mock.calls[0]![1]).toMatchObject({ title: 'Corrigir autenticação', priority: 'high', labels: ['area:api', 'auth'], status: 'backlog', parentId: null })
    expect(onSaved).toHaveBeenCalled()
  })

  it('creates a subtask under its parent', async () => {
    renderWithQuery(<TaskDialog mode="create" slug="produto" parent={makeTask({ id: '42' })} open onOpenChange={() => {}} />)
    expect(screen.getByText('New subtask of #42')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Title'), 'Backend')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(createTask.mock.calls[0]![1]).toMatchObject({ title: 'Backend', parentId: '42' }))
  })

  it('edits and says the change goes to GitHub first when the task is bound', async () => {
    const task = makeTask({ github: { repository: 'acme/api', number: 3, htmlUrl: 'u', state: 'open', syncState: 'synced', lastSyncedAt: null, lastError: null, remoteUpdatedAt: null, metadataSource: 'labels', remote: null } })
    renderWithQuery(<TaskDialog mode="edit" slug="produto" task={task} open onOpenChange={() => {}} />)
    expect(screen.getByText(/written there first/)).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'review')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(patchTask).toHaveBeenCalledWith('42', expect.objectContaining({ status: 'review' })))
  })
})
