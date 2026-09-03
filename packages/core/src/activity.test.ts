import { describe, expect, it } from 'vitest'
import { ACTIVITY_KINDS, activityEntity, isActivityKind } from './activity.js'
import { reconcileBinding, taskFieldsFromIssue } from './tasks.js'

describe('activity kinds', () => {
  it('are a closed vocabulary grouped by entity', () => {
    expect(isActivityKind('task.status')).toBe(true)
    expect(isActivityKind('docker.pruned')).toBe(false)
    expect(activityEntity('environment.rebuilt')).toBe('environment')
    expect(new Set(ACTIVITY_KINDS).size).toBe(ACTIVITY_KINDS.length)
  })
})

describe('binding reconciliation', () => {
  it('applies the remote when nothing is pending locally', () => {
    expect(reconcileBinding({ syncState: 'synced', localUpdatedAt: 10, remoteUpdatedAt: 5 }, { updatedAt: 20 })).toBe('apply-remote')
  })
  it('keeps a pending local edit when the remote did not move', () => {
    expect(reconcileBinding({ syncState: 'pending', localUpdatedAt: 10, remoteUpdatedAt: 5 }, { updatedAt: 5 })).toBe('keep-local')
  })
  it('is a conflict when both moved', () => {
    expect(reconcileBinding({ syncState: 'pending', localUpdatedAt: 10, remoteUpdatedAt: 5 }, { updatedAt: 9 })).toBe('conflict')
    expect(reconcileBinding({ syncState: 'pending', localUpdatedAt: 10, remoteUpdatedAt: null }, { updatedAt: 9 })).toBe('conflict')
  })
})

describe('task fields from an issue', () => {
  it('reads status and priority, closes a closed issue, and drops the convention labels', () => {
    const fields = taskFieldsFromIssue({
      title: 'Fix auth', body: null, state: 'closed', workflowStatus: 'review', priority: 'high', issueType: 'Bug',
      labels: ['status:review', 'priority:high', 'area:api'], assignees: ['ada', 'bob'], updatedAt: 99,
    })
    expect(fields).toEqual({ title: 'Fix auth', description: null, status: 'done', priority: 'high', type: 'Bug', labels: ['area:api'], assignee: 'ada', closedAt: 99 })
  })
  it('defaults an open issue with no status to backlog', () => {
    expect(taskFieldsFromIssue({ title: 't', body: 'b', state: 'open', workflowStatus: null, priority: 'nope', issueType: null, labels: [], assignees: [], updatedAt: 1 }))
      .toMatchObject({ status: 'backlog', priority: null, closedAt: null })
  })
})
