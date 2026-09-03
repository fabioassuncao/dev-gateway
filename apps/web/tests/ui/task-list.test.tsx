import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithQuery } from './render.tsx'
import { makeTaskSummary } from './fixtures.ts'
import { TaskList } from '../../src/ui/components/tasks/task-list.tsx'
import { matchesFilters, nestTasks, tasksHref, boardToTasksHref } from '../../src/ui/lib/tasks.ts'

describe('the task list', () => {
  it('nests subtasks under their parent', () => {
    const tasks = [
      makeTaskSummary({ id: '1', title: 'Parent', subtaskCount: 2, openSubtaskCount: 1 }),
      makeTaskSummary({ id: '2', title: 'Child A', parentId: '1' }),
      makeTaskSummary({ id: '3', title: 'Orphan', parentId: '99' }),
      makeTaskSummary({ id: '4', title: 'Child B', parentId: '1', status: 'done' }),
    ]
    expect(nestTasks(tasks).map((row) => `${row.task.id}:${row.depth}`)).toEqual(['1:0', '2:1', '4:1', '3:0'])
    renderWithQuery(<TaskList slug="produto" tasks={tasks} />)
    expect(screen.getByRole('group', { name: '#2 Child A' })).toHaveStyle({ paddingLeft: '36px' })
    expect(screen.getByText('1/2 subtasks')).toBeInTheDocument()
  })

  it('says what a task is when there is none', () => {
    renderWithQuery(<TaskList slug="produto" tasks={[]} />)
    expect(screen.getByText('No task yet')).toBeInTheDocument()
  })
})

describe('task addressing and filters', () => {
  it('keeps a filtered board as a link', () => {
    expect(tasksHref('produto', 'board')).toBe('/projects/produto/tasks')
    expect(tasksHref('produto', 'list', { status: 'blocked', q: 'auth' })).toBe('/projects/produto/tasks?view=list&status=blocked&q=auth')
    expect(boardToTasksHref('produto', 'backlog', '?priority=urgent&q=x')).toBe('/projects/produto/tasks?view=list&q=x')
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
})
