import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { renderWithQuery } from './render.tsx'
import type { Issue, Workspace } from '../../src/shared/types.ts'

class ApiError extends Error {
  status: number
  hint: string
  constructor(status: number, message: string, hint = '') {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.hint = hint
  }
}

const workspaceIssues = vi.fn()
const patchIssue = vi.fn()
const createIssue = vi.fn()
const workspace = vi.fn()

vi.mock('../../src/ui/lib/api.ts', () => ({
  ApiError,
  api: {
    workspaceIssues: (slug: string, filters: unknown) => workspaceIssues(slug, filters),
    patchIssue: (id: string, body: unknown) => patchIssue(id, body),
    createIssue: (repository: string, body: unknown) => createIssue(repository, body),
    workspace: (slug: string) => workspace(slug),
  },
}))

const { BoardPage, resolveView } = await import('../../src/ui/pages/Board.tsx')
const { DEFAULT_COLUMNS, columnFor } = await import('../../src/ui/components/issue-board.tsx')

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: '1',
    repository: 'acme/produto-api',
    number: 123,
    title: 'Implementar refresh token',
    body: null,
    state: 'open',
    stateReason: null,
    issueType: 'Bug',
    status: 'in_progress',
    priority: 'high',
    metadataSource: 'labels',
    labels: [],
    assignees: ['fabio'],
    milestone: null,
    htmlUrl: 'https://github.com/acme/produto-api/issues/123',
    parentId: null,
    childIds: [],
    githubUpdatedAt: 1_700_000_000,
    syncedAt: 1_700_000_000,
    stale: false,
    ...overrides,
  }
}

const detail: Workspace = {
  slug: 'produto',
  name: 'Meu Produto',
  description: null,
  archived: false,
  repositories: [
    {
      repositoryId: 'r1', fullName: 'acme/produto-api', htmlUrl: 'https://github.com/acme/produto-api',
      defaultBranch: 'main', private: true, archived: false, role: 'api', position: 0,
    },
  ],
  environments: [],
}

beforeEach(() => {
  workspaceIssues.mockReset().mockResolvedValue([issue()])
  patchIssue.mockReset().mockImplementation(async (_id: string, body: { status: string }) =>
    issue({ status: body.status as Issue['status'] }),
  )
  createIssue.mockReset().mockResolvedValue(issue())
  workspace.mockReset().mockResolvedValue(detail)
  window.location.hash = '/board/produto/board'
})

describe('resolveView', () => {
  it('defaults to the board', () => {
    expect(resolveView(null)).toBe('board')
    expect(resolveView('nope')).toBe('board')
    expect(resolveView('backlog')).toBe('backlog')
  })
})

describe('columnFor', () => {
  it('puts an issue in the column matching its status', () => {
    expect(columnFor(issue({ status: 'review' }), DEFAULT_COLUMNS).id).toBe('review')
  })

  it('falls back to the first column when there is no status', () => {
    expect(columnFor(issue({ status: null }), DEFAULT_COLUMNS).id).toBe('backlog')
  })
})

describe('the board', () => {
  it('shows the six default columns with their counts', async () => {
    renderWithQuery(<BoardPage slug="produto" view="board" filters={{}} />)
    await screen.findByRole('region', { name: 'In Progress column' })
    for (const label of ['Backlog', 'Ready', 'In Progress', 'Review', 'Blocked', 'Done']) {
      expect(screen.getByRole('region', { name: `${label} column` })).toBeInTheDocument()
    }
    const inProgress = screen.getByRole('region', { name: 'In Progress column' })
    expect(within(inProgress).getByRole('article', { name: /#123/ })).toBeInTheDocument()
  })

  it('identifies the repository on every card', async () => {
    renderWithQuery(<BoardPage slug="produto" view="board" filters={{}} />)
    const card = await screen.findByRole('article', { name: /#123/ })
    expect(within(card).getByText('produto-api')).toBeInTheDocument()
  })

  it('moves a card without a pointer, through the same mutation', async () => {
    renderWithQuery(<BoardPage slug="produto" view="board" filters={{}} />)
    await screen.findByRole('article', { name: /#123/ })

    await userEvent.click(screen.getByRole('button', { name: /Actions for acme\/produto-api#123/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Move to Done' }))

    await waitFor(() => expect(patchIssue).toHaveBeenCalledWith('1', { status: 'done' }))
  })

  it('shows the move immediately and announces it', async () => {
    const pending: { resolve?: (value: Issue) => void } = {}
    patchIssue.mockImplementation(() => new Promise<Issue>((done) => { pending.resolve = done }))

    renderWithQuery(<BoardPage slug="produto" view="board" filters={{}} />)
    await screen.findByRole('article', { name: /#123/ })

    await userEvent.click(screen.getByRole('button', { name: /Actions for acme\/produto-api#123/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Move to Done' }))

    // Optimistic: the card is in Done before the request settles.
    await waitFor(() => {
      const done = screen.getByRole('region', { name: 'Done column' })
      expect(within(done).getByRole('article', { name: /#123/ })).toBeInTheDocument()
    })
    expect(screen.getByText('acme/produto-api#123 moved to Done')).toBeInTheDocument()
    pending.resolve?.(issue({ status: 'done' }))
  })

  it('rolls a failed move back and explains why', async () => {
    patchIssue.mockRejectedValue(new ApiError(400, 'acme/produto-api is not a repository this gateway was granted'))

    renderWithQuery(<BoardPage slug="produto" view="board" filters={{}} />)
    await screen.findByRole('article', { name: /#123/ })

    await userEvent.click(screen.getByRole('button', { name: /Actions for acme\/produto-api#123/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Move to Done' }))

    expect(
      await screen.findByText('acme/produto-api is not a repository this gateway was granted'),
    ).toBeInTheDocument()
    await waitFor(() => {
      const inProgress = screen.getByRole('region', { name: 'In Progress column' })
      expect(within(inProgress).getByRole('article', { name: /#123/ })).toBeInTheDocument()
    })
  })

  it('puts a filter in the URL so a filtered board is a link', async () => {
    renderWithQuery(<BoardPage slug="produto" view="board" filters={{}} />)
    await screen.findByRole('article', { name: /#123/ })

    await userEvent.selectOptions(screen.getByLabelText('Priority'), 'urgent')
    await waitFor(() => expect(window.location.hash).toContain('priority=urgent'))
  })

  it('passes the filters through to the request', async () => {
    renderWithQuery(<BoardPage slug="produto" view="board" filters={{ priority: 'urgent' }} />)
    await waitFor(() =>
      expect(workspaceIssues).toHaveBeenCalledWith('produto', { priority: 'urgent', state: 'open' }),
    )
  })

  it('hides the write affordances in read-only mode instead of failing on use', async () => {
    renderWithQuery(<BoardPage slug="produto" view="board" filters={{}} readOnly />)
    await screen.findByRole('article', { name: /#123/ })

    expect(screen.getByRole('button', { name: /New issue/ })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: /Actions for acme\/produto-api#123/ }))
    expect(await screen.findByRole('menuitem', { name: 'Move to Done' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('says the database is needed rather than showing a stack', async () => {
    workspaceIssues.mockRejectedValue(new ApiError(503, 'panel persistence is unavailable'))
    renderWithQuery(<BoardPage slug="produto" view="board" filters={{}} />)
    expect(await screen.findByText("The board needs the panel's database")).toBeInTheDocument()
  })

  it('explains an empty board rather than showing six blank columns', async () => {
    workspaceIssues.mockResolvedValue([])
    renderWithQuery(<BoardPage slug="produto" view="board" filters={{}} />)
    expect(await screen.findByText('No issue matches these filters')).toBeInTheDocument()
  })
})

describe('the backlog', () => {
  it('is a list of what has no status yet, not the board', async () => {
    workspaceIssues.mockResolvedValue([issue(), issue({ id: '2', number: 124, title: 'Sem status', status: null })])
    renderWithQuery(<BoardPage slug="produto" view="backlog" filters={{}} />)

    expect(await screen.findByText('Sem status')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Backlog column' })).not.toBeInTheDocument()
    expect(screen.queryByText('Implementar refresh token')).not.toBeInTheDocument()
  })

  it('opens an issue for editing from a row', async () => {
    workspaceIssues.mockResolvedValue([issue({ status: null })])
    renderWithQuery(<BoardPage slug="produto" view="backlog" filters={{}} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Implementar refresh token' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('#123')
  })
})

describe('creating an issue', () => {
  it('writes to GitHub through the repositories the workspace owns', async () => {
    renderWithQuery(<BoardPage slug="produto" view="board" filters={{}} />)
    await screen.findByRole('article', { name: /#123/ })

    await userEvent.click(screen.getByRole('button', { name: /New issue/ }))
    await userEvent.type(screen.getByLabelText('Title'), 'Nova tarefa')
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'ready')
    await userEvent.click(screen.getByRole('button', { name: 'Create on GitHub' }))

    await waitFor(() => expect(createIssue).toHaveBeenCalled())
    expect(createIssue.mock.calls[0]![0]).toBe('acme/produto-api')
    expect(createIssue.mock.calls[0]![1]).toMatchObject({ title: 'Nova tarefa', status: 'ready' })
  })

  it('cannot be started for a workspace with no repository', async () => {
    workspace.mockResolvedValue({ ...detail, repositories: [] })
    renderWithQuery(<BoardPage slug="produto" view="board" filters={{}} />)
    await screen.findByRole('article', { name: /#123/ })
    expect(screen.getByRole('button', { name: /New issue/ })).toBeDisabled()
  })
})
