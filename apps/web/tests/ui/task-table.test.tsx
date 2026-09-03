import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { renderWithQuery } from './render.tsx'
import { makeTaskSummary } from './fixtures.ts'
import { TaskTable } from '../../src/ui/components/tasks/task-table.tsx'
import {
  boardToTasksHref,
  labelsOf,
  matchesFilters,
  nestTasks,
  resolveTaskView,
  tasksHref,
  typesOf,
} from '../../src/ui/lib/tasks.ts'

const COLUMNS = [
  { id: 'backlog', label: 'Backlog', status: 'backlog' as const },
  { id: 'in_progress', label: 'In progress', status: 'in_progress' as const },
  { id: 'done', label: 'Done', status: 'done' as const },
]

beforeEach(() => {
  localStorage.clear()
})

describe('the task table', () => {
  const tasks = [
    makeTaskSummary({ id: '1', title: 'Parent', subtaskCount: 2, openSubtaskCount: 1, priority: 'low', updatedAt: 30 }),
    makeTaskSummary({ id: '2', title: 'Child A', parentId: '1', priority: 'urgent', updatedAt: 10 }),
    makeTaskSummary({ id: '3', title: 'Orphan', parentId: '99', priority: null, updatedAt: 20 }),
  ]

  it('keeps a subtask under its parent until a column is sorted on', async () => {
    renderWithQuery(<TaskTable slug="produto" tasks={tasks} columns={COLUMNS} />)
    const titles = () => screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('link')[1]?.textContent)
    expect(titles()).toEqual(['Parent', 'Child A', 'Orphan'])

    await userEvent.click(screen.getByRole('button', { name: /Priority/ }))
    // Ascending by rank: no priority, then low, then urgent.
    expect(titles()).toEqual(['Orphan', 'Parent', 'Child A'])
  })

  it('links every row to the task it is', () => {
    renderWithQuery(<TaskTable slug="produto" tasks={tasks} columns={COLUMNS} />)
    expect(screen.getByRole('link', { name: '#1' })).toHaveAttribute('href', '#/projects/produto/tasks/1')
    expect(screen.getByRole('link', { name: 'Parent' })).toHaveAttribute('href', '#/projects/produto/tasks/1')
  })

  it('changes a status from the row, without opening the task', async () => {
    const setStatus = vi.fn()
    renderWithQuery(<TaskTable slug="produto" tasks={[tasks[0]!]} columns={COLUMNS} onSetStatus={setStatus} />)
    await userEvent.click(screen.getByRole('button', { name: 'Actions for #1' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Move to Done' }))
    expect(setStatus).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }), 'done')
  })

  it('offers no status change at all when the panel is read-only', async () => {
    renderWithQuery(<TaskTable slug="produto" tasks={[tasks[0]!]} columns={COLUMNS} readOnly />)
    await userEvent.click(screen.getByRole('button', { name: 'Actions for #1' }))
    expect(await screen.findByRole('menuitem', { name: 'Open' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Move to Done' })).not.toBeInTheDocument()
  })

  it('says the section is empty rather than showing a table with no rows', () => {
    renderWithQuery(<TaskTable slug="produto" tasks={[]} columns={COLUMNS} />)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByText('Nothing to show')).toBeInTheDocument()
  })
})

describe('task addressing and filters', () => {
  it('takes the old list view to the table it became', () => {
    expect(resolveTaskView('list')).toBe('table')
    expect(resolveTaskView('table')).toBe('table')
    expect(resolveTaskView(null)).toBe('board')
  })

  it('keeps a filtered view as a link', () => {
    expect(tasksHref('produto', 'board')).toBe('/projects/produto/tasks')
    expect(tasksHref('produto', 'table', { status: 'blocked', q: 'auth' })).toBe('/projects/produto/tasks?view=table&status=blocked&q=auth')
    // Priority is a real filter now, so a legacy link keeps it instead of dropping it.
    expect(boardToTasksHref('produto', 'backlog', '?priority=urgent&q=x')).toBe('/projects/produto/tasks?view=table&priority=urgent&q=x')
  })

  it('narrows by status, worker, repository and text', () => {
    const task = makeTaskSummary({ agent: 'claude-code', assignee: null })
    expect(matchesFilters(task, { status: 'in_progress,review' })).toBe(true)
    expect(matchesFilters(task, { status: 'done' })).toBe(false)
    expect(matchesFilters(task, { assignee: 'claude-code' })).toBe(true)
    expect(matchesFilters(task, { repository: 'r2' })).toBe(false)
    expect(matchesFilters(task, { q: 'refresh' })).toBe(true)
    expect(matchesFilters(task, { q: '#42' })).toBe(true)
  })

  it('narrows by priority, label and type', () => {
    const task = makeTaskSummary({ priority: 'high', labels: ['api', 'ux'], type: 'refactor' })
    expect(matchesFilters(task, { priority: 'high' })).toBe(true)
    expect(matchesFilters(task, { priority: 'low' })).toBe(false)
    expect(matchesFilters(task, { label: 'ux' })).toBe(true)
    expect(matchesFilters(task, { label: 'infra' })).toBe(false)
    expect(matchesFilters(task, { type: 'refactor' })).toBe(true)
    // "refactor" is what improvement is called here; the vocabulary knows that.
    expect(matchesFilters(task, { type: 'improvement' })).toBe(true)
    expect(matchesFilters(task, { type: 'bug' })).toBe(false)
  })

  it('collects the labels and types a set of tasks actually uses', () => {
    const tasks = [
      makeTaskSummary({ id: '1', labels: ['ux', 'api'], type: 'bug' }),
      makeTaskSummary({ id: '2', labels: ['api'], type: null }),
    ]
    expect(labelsOf(tasks)).toEqual(['api', 'ux'])
    expect(typesOf(tasks)).toEqual(['bug'])
  })

  it('nests subtasks under their parent', () => {
    const tasks = [
      makeTaskSummary({ id: '1', title: 'Parent' }),
      makeTaskSummary({ id: '2', title: 'Child A', parentId: '1' }),
      makeTaskSummary({ id: '3', title: 'Orphan', parentId: '99' }),
      makeTaskSummary({ id: '4', title: 'Child B', parentId: '1', status: 'done' }),
    ]
    expect(nestTasks(tasks).map((row) => `${row.task.id}:${row.depth}`)).toEqual(['1:0', '2:1', '4:1', '3:0'])
  })
})
