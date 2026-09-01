import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { IssueRows, nest } from '../../src/ui/components/issue-list.tsx'
import type { Issue } from '../../src/shared/types.ts'

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
    labels: ['status:in-progress'],
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

describe('nesting sub-issues', () => {
  it('puts a child under its parent', () => {
    const parent = issue({ id: '1', childIds: ['2'] })
    const child = issue({ id: '2', number: 124, parentId: '1' })
    expect(nest([parent, child]).map((row) => [row.issue.id, row.depth])).toEqual([
      ['1', 0],
      ['2', 1],
    ])
  })

  it('keeps a child whose parent is not visible at the top level', () => {
    const orphan = issue({ id: '2', number: 124, parentId: '99' })
    expect(nest([orphan])).toEqual([{ issue: orphan, depth: 0 }])
  })

  it('lists every issue exactly once even when the data claims a cycle', () => {
    const first = issue({ id: '1', childIds: ['2'] })
    const second = issue({ id: '2', number: 124, parentId: '1', childIds: ['1'] })
    const rows = nest([first, second])
    expect(rows.map((row) => row.issue.id).sort()).toEqual(['1', '2'])
  })
})

describe('the issue rows', () => {
  it('badges the repository and links the number to GitHub', () => {
    render(<IssueRows issues={[issue()]} />)
    const row = screen.getByRole('group', { name: 'acme/produto-api#123' })
    expect(within(row).getByText('produto-api')).toBeInTheDocument()
    expect(within(row).getByRole('link', { name: '#123' })).toHaveAttribute(
      'href',
      'https://github.com/acme/produto-api/issues/123',
    )
  })

  it('says where a status came from, because it changes what a write does', () => {
    render(<IssueRows issues={[issue()]} />)
    expect(screen.getByTitle('from the status: label convention')).toBeInTheDocument()
  })

  it('marks a native field differently from a label', () => {
    render(<IssueRows issues={[issue({ metadataSource: 'fields' })]} />)
    expect(screen.getByTitle('from a native GitHub field')).toBeInTheDocument()
  })

  it('counts sub-issues only when there are any', () => {
    render(<IssueRows issues={[issue({ childIds: ['2', '3'] }), issue({ id: '2', number: 124 })]} />)
    expect(screen.getByText('2 sub-issues')).toBeInTheDocument()
  })

  it('shows the sync age when the projection is stale', () => {
    render(<IssueRows issues={[issue({ stale: true })]} />)
    expect(screen.getByText(/^synced /)).toBeInTheDocument()
  })

  it('explains an empty list rather than showing nothing', () => {
    render(<IssueRows issues={[]} />)
    expect(screen.getByText('No issue matches')).toBeInTheDocument()
  })
})
