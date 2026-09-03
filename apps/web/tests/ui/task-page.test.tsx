import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { renderWithQuery } from './render.tsx'
import { makeEvent, makeSession, makeTask, makeTaskSummary } from './fixtures.ts'

class ApiError extends Error {
  status: number
  hint: string
  constructor(status: number, message: string, hint = '') {
    super(message)
    this.status = status
    this.hint = hint
  }
}

const task = vi.fn()
const project = vi.fn()
const sessions = vi.fn()
const projectActivity = vi.fn()
const github = vi.fn()
const setTaskStatus = vi.fn()
const startTask = vi.fn()
const finishTask = vi.fn()
const addTaskNote = vi.fn()
const syncTaskGitHub = vi.fn()
const linkTaskGitHub = vi.fn()
const setTaskEnvironments = vi.fn()

vi.mock('../../src/ui/lib/api/index.ts', () => ({
  ApiError,
  api: {
    task: (id: string) => task(id),
    project: (slug: string) => project(slug),
    sessions: (slug: string, filters: unknown) => sessions(slug, filters),
    projectActivity: (slug: string, filters: unknown) => projectActivity(slug, filters),
    github: () => github(),
    setTaskStatus: (id: string, status: string) => setTaskStatus(id, status),
    startTask: (id: string) => startTask(id),
    finishTask: (id: string, close?: boolean) => finishTask(id, close),
    addTaskNote: (id: string, body: string) => addTaskNote(id, body),
    syncTaskGitHub: (id: string, resolve?: string) => syncTaskGitHub(id, resolve),
    linkTaskGitHub: (id: string, issue: string) => linkTaskGitHub(id, issue),
    setTaskEnvironments: (id: string, environments: string[]) => setTaskEnvironments(id, environments),
  },
}))

const { TaskPage } = await import('../../src/ui/pages/Task.tsx')

const detail = makeTask({
  subtasks: [makeTaskSummary({ id: '43', title: 'Backend', parentId: '42', status: 'done' }), makeTaskSummary({ id: '44', title: 'Frontend', parentId: '42', repository: { id: 'r2', name: 'web' } })],
  subtaskCount: 2,
  openSubtaskCount: 1,
  notes: [{ id: 'n1', actor: 'claude', actorKind: 'agent', body: 'Tests pass locally.', createdAt: 1_700_000_100 }],
  environments: [{ environment: 'produto-task42', source: 'branch', reason: 'linked because this environment is on branch task-42-auth', running: true, serviceCount: 2, runningCount: 2, unhealthyCount: 0, branch: 'task-42-auth', urls: [{ url: 'http://produto-web.localhost', scope: 'local' }], panelUrl: '#/environments/produto-task42' }],
})

beforeEach(() => {
  task.mockReset().mockResolvedValue(detail)
  project.mockReset().mockResolvedValue({ id: '1', slug: 'produto', name: 'Meu Produto', description: null, archived: false, relativePath: null, resolvedPath: null, location: 'external', repositories: [], githubRepositories: [], environments: [{ environment: 'produto', source: 'manual', running: true, serviceCount: 1, runningCount: 1, unhealthyCount: 0, urls: [] }] })
  sessions.mockReset().mockResolvedValue([makeSession()])
  projectActivity.mockReset().mockResolvedValue({ events: [makeEvent()], nextBefore: null })
  github.mockReset().mockResolvedValue({ status: { configured: true } })
  setTaskStatus.mockReset().mockResolvedValue(detail)
  startTask.mockReset().mockResolvedValue(detail)
  finishTask.mockReset().mockResolvedValue(detail)
  addTaskNote.mockReset().mockResolvedValue(detail.notes[0])
  syncTaskGitHub.mockReset().mockResolvedValue(detail)
  linkTaskGitHub.mockReset().mockResolvedValue(detail)
  setTaskEnvironments.mockReset().mockResolvedValue(detail)
})

describe('one task', () => {
  it('shows what it is, who is on it, what came out, and where it runs', async () => {
    renderWithQuery(<TaskPage slug="produto" id="42" />)
    expect(await screen.findByRole('heading', { name: '#42 Implementar refresh token' })).toBeInTheDocument()
    expect(screen.getByText('The refresh token expires too early.')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '#44 Frontend' })).toBeInTheDocument()
    expect(screen.getByText('Subtasks 1/2')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'claude session' })).toBeInTheDocument()
    expect(screen.getByText('Add totals')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'produto-task42' })).toHaveAttribute('href', '#/environments/produto-task42')
    expect(screen.getByText('Tests pass locally.')).toBeInTheDocument()
    expect(screen.getByText('#42 moved to in progress')).toBeInTheDocument()
    expect(screen.getByText(/Not bound to a GitHub issue/)).toBeInTheDocument()
  })

  it('walks Projects, the project and Tasks in the breadcrumb, with no link trio below the title', async () => {
    renderWithQuery(<TaskPage slug="produto" id="42" />)
    await screen.findByRole('heading', { name: '#42 Implementar refresh token' })
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(nav).getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '#/projects')
    expect(await within(nav).findByRole('link', { name: 'Meu Produto' })).toHaveAttribute('href', '#/projects/produto')
    expect(within(nav).getByRole('link', { name: 'Tasks' })).toHaveAttribute('href', '#/projects/produto/tasks')
    expect(within(nav).getByText('#42')).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('link', { name: 'All tasks' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Part of #42' })).toBeNull()
  })

  it('adds the parent task as a crumb of a subtask', async () => {
    task.mockResolvedValue(makeTask({ id: '44', title: 'Frontend', parentId: '42', subtasks: [], subtaskCount: 0, openSubtaskCount: 0 }))
    renderWithQuery(<TaskPage slug="produto" id="44" />)
    await screen.findByRole('heading', { name: '#44 Frontend' })
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(nav).getByRole('link', { name: '#42' })).toHaveAttribute('href', '#/projects/produto/tasks/42')
    expect(within(nav).getByText('#44')).toHaveAttribute('aria-current', 'page')
  })

  it('sends the task to review and adds a note', async () => {
    renderWithQuery(<TaskPage slug="produto" id="42" />)
    await screen.findByRole('heading', { name: '#42 Implementar refresh token' })
    await userEvent.click(screen.getByRole('button', { name: 'Send to review' }))
    await waitFor(() => expect(setTaskStatus).toHaveBeenCalledWith('42', 'review'))
    await userEvent.type(screen.getByLabelText(/Leave a note/), 'Please retry the flaky test')
    await userEvent.click(screen.getByRole('button', { name: 'Add note' }))
    await waitFor(() => expect(addTaskNote).toHaveBeenCalledWith('42', 'Please retry the flaky test'))
  })

  it('binds an issue by its coordinate', async () => {
    renderWithQuery(<TaskPage slug="produto" id="42" />)
    await screen.findByRole('heading', { name: '#42 Implementar refresh token' })
    await userEvent.click(screen.getByRole('button', { name: 'Bind an issue' }))
    await userEvent.type(screen.getByLabelText('owner/repo#number'), 'acme/api#7')
    await userEvent.click(screen.getByRole('button', { name: 'Bind an issue' }))
    await waitFor(() => expect(linkTaskGitHub).toHaveBeenCalledWith('42', 'acme/api#7'))
  })

  it('shows a conflict with both sides and lets a person choose', async () => {
    task.mockResolvedValue(makeTask({
      github: { repository: 'acme/api', number: 7, htmlUrl: 'https://github.com/acme/api/issues/7', state: 'open', syncState: 'conflict', lastSyncedAt: 1_700_000_000, lastError: null, remoteUpdatedAt: 1_700_000_500, metadataSource: 'labels', remote: { title: 'Refresh token (renamed)', status: 'review', priority: null, assignee: 'ada' } },
    }))
    renderWithQuery(<TaskPage slug="produto" id="42" />)
    const section = await screen.findByRole('group', { name: 'GitHub' })
    expect(within(section).getByText(/Refresh token \(renamed\)/)).toBeInTheDocument()
    await userEvent.click(within(section).getByRole('button', { name: "Take GitHub's" }))
    await waitFor(() => expect(syncTaskGitHub).toHaveBeenCalledWith('42', 'remote'))
  })

  it('says when the task does not exist, still under its project and Tasks', async () => {
    task.mockRejectedValue(new ApiError(404, 'no task'))
    renderWithQuery(<TaskPage slug="produto" id="99" />)
    expect(await screen.findByText('No task #99')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'All tasks' })).toHaveAttribute('href', '#/projects/produto/tasks')
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(nav).getByRole('link', { name: 'Tasks' })).toHaveAttribute('href', '#/projects/produto/tasks')
    expect(within(nav).getByText('#99')).toHaveAttribute('aria-current', 'page')
  })
})
