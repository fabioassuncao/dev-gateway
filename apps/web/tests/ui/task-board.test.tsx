import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { renderWithQuery } from './render.tsx'
import { makeTaskSummary } from './fixtures.ts'
import { TaskBoard } from '../../src/ui/components/tasks/task-board.tsx'

describe('the task board', () => {
  it('puts each task in the column of its status and moves it from the menu', async () => {
    const onMove = vi.fn()
    const tasks = [
      makeTaskSummary({ id: '1', status: 'ready', title: 'Ready one' }),
      makeTaskSummary({ id: '2', status: 'in_progress', title: 'Busy one', agent: 'claude-code', assignee: null }),
      makeTaskSummary({ id: '3', status: 'done', title: 'Done one', github: { repository: 'acme/api', number: 9, htmlUrl: 'https://github.com/acme/api/issues/9', syncState: 'conflict' } }),
    ]
    renderWithQuery(<TaskBoard slug="produto" tasks={tasks} onMove={onMove} />)

    expect(within(screen.getByRole('region', { name: 'To do column' })).getByRole('article', { name: '#1 Ready one' })).toBeInTheDocument()
    const busy = within(screen.getByRole('region', { name: 'In progress column' })).getByRole('article', { name: '#2 Busy one' })
    expect(within(busy).getByText('claude-code')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Done column' })).getByLabelText('conflict')).toBeInTheDocument()

    await userEvent.click(within(busy).getByRole('button', { name: 'Actions for #2' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Move to Review' }))
    expect(onMove).toHaveBeenCalledWith(tasks[1], 'review')
    expect(screen.getByText('#2 moved to Review')).toBeInTheDocument()
  })

  it('links every card to its task page', () => {
    renderWithQuery(<TaskBoard slug="produto" tasks={[makeTaskSummary({ id: '5', title: 'Linked' })]} onMove={vi.fn()} />)
    expect(screen.getByRole('link', { name: 'Linked' })).toHaveAttribute('href', '#/projects/produto/tasks/5')
  })
})
