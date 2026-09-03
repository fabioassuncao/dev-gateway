import { describe, expect, it } from 'vitest'
import {
  finishPlan,
  flattenSubtasks,
  isBlockedBySubtasks,
  isIntactDraft,
  isOpenStatus,
  nextTask,
  parseTaskRef,
  priorityRank,
  readActor,
  shouldPromoteDraft,
  startPlan,
  statusDefinition,
  subtaskTree,
  taskIdFromBranch,
  taskIdFromLabel,
  taskIdFromNamespace,
  TASK_STATUS_CATALOG,
  type SchedulableTask,
} from './tasks.js'
import { flattenExampleTasks, ExampleDocument } from './task-example.js'

function task(overrides: Partial<SchedulableTask> & { id: string }): SchedulableTask {
  return { parentId: null, status: 'ready', priority: null, assignee: null, waitingSince: 100, ...overrides }
}

describe('parseTaskRef', () => {
  it('reads a GitHub coordinate', () => expect(parseTaskRef('acme/api#42')).toEqual({ kind: 'coordinate', repository: 'acme/api', number: 42 }))
  it('reads an encoded coordinate', () => expect(parseTaskRef('acme%2Fapi%2342')).toEqual({ kind: 'coordinate', repository: 'acme/api', number: 42 }))
  it('reads a local id with or without a hash', () => {
    expect(parseTaskRef('17')).toEqual({ kind: 'id', id: '17' })
    expect(parseTaskRef('#17')).toEqual({ kind: 'id', id: '17' })
  })
  it('refuses what is neither', () => {
    expect(parseTaskRef('')).toBeNull()
    expect(parseTaskRef('acme/api#0')).toBeNull()
    expect(parseTaskRef('not-a-task')).toBeNull()
    expect(parseTaskRef('%E0%A4%A')).toBeNull()
  })
})

describe('nextTask', () => {
  it('offers only ready, unblocked, unassigned work', () => {
    const tasks = [
      task({ id: '1', status: 'backlog' }),
      task({ id: '2', status: 'in_progress' }),
      task({ id: '3', assignee: 'someone-else' }),
      task({ id: '4' }),
      task({ id: '5', parentId: '4', status: 'in_progress' }),
      task({ id: '6', priority: 'low' }),
    ]
    expect(isBlockedBySubtasks(tasks[3]!, tasks)).toBe(true)
    expect(nextTask(tasks)?.id).toBe('6')
  })
  it('lets the caller take back its own task', () => {
    expect(nextTask([task({ id: '1', assignee: 'claude' })], { actor: 'claude' })?.id).toBe('1')
    expect(nextTask([task({ id: '1', assignee: 'claude' })], { actor: 'other' })).toBeNull()
  })
  it('orders by priority, then by how long a task has waited, then by id', () => {
    const tasks = [
      task({ id: 'b', priority: 'high', waitingSince: 50 }),
      task({ id: 'a', priority: 'high', waitingSince: 50 }),
      task({ id: 'c', priority: 'urgent', waitingSince: 90 }),
      task({ id: 'd', waitingSince: 1 }),
    ]
    expect(nextTask(tasks)?.id).toBe('c')
    expect(nextTask(tasks.filter((t) => t.id !== 'c'))?.id).toBe('a')
    expect(priorityRank(null)).toBeGreaterThan(priorityRank('low'))
  })
  it('answers null when there is nothing to do', () => expect(nextTask([])).toBeNull())
})

describe('subtaskTree', () => {
  it('builds a tree and survives a cycle', () => {
    const tasks = [
      { id: '1', parentId: null },
      { id: '2', parentId: '1' },
      { id: '3', parentId: '2' },
      { id: '4', parentId: '3' },
      { id: '1', parentId: '4' },
    ]
    const tree = subtaskTree('1', tasks)
    expect(flattenSubtasks(tree).map((t) => t.id)).toEqual(['2', '3', '4'])
  })
})

describe('transitions', () => {
  it('start assigns the actor unless already assigned', () => {
    expect(startPlan({ assignee: null }, 'claude')).toEqual({ status: 'in_progress', assignee: 'claude', close: false })
    expect(startPlan({ assignee: 'claude' }, 'claude').assignee).toBeNull()
    expect(startPlan({ assignee: null }, null).assignee).toBeNull()
  })
  it('finish closes only when asked', () => {
    expect(finishPlan(true)).toEqual({ status: 'done', assignee: null, close: true })
    expect(finishPlan(false).close).toBe(false)
  })
})

describe('actor', () => {
  it('accepts a bounded printable name and nothing else', () => {
    expect(readActor(' claude-code ')).toBe('claude-code')
    expect(readActor('with space')).toBeNull()
    expect(readActor('x'.repeat(65))).toBeNull()
    expect(readActor(undefined)).toBeNull()
  })
})

describe('status catalog', () => {
  it('covers every status and marks only done as terminal', () => {
    expect(TASK_STATUS_CATALOG.map((entry) => entry.id)).toEqual(['backlog', 'ready', 'in_progress', 'review', 'blocked', 'done'])
    expect(statusDefinition('done')?.terminal).toBe(true)
    expect(isOpenStatus('ready')).toBe(true)
    expect(isOpenStatus('done')).toBe(false)
  })
})

describe('drafts', () => {
  const intact = {
    draft: true, title: 'New task', description: null, status: 'backlog' as const,
    priority: null, type: null, labels: [], assignee: null, agent: null, service: null, dueAt: null,
  }
  it('treats the placeholder as intact and promotes on a real title', () => {
    expect(isIntactDraft(intact)).toBe(true)
    expect(shouldPromoteDraft(intact, { title: 'Configurar API' })).toBe(true)
    expect(shouldPromoteDraft(intact, { title: 'New task' })).toBe(false)
    expect(shouldPromoteDraft(intact, { title: 'Nova tarefa' })).toBe(false)
    expect(shouldPromoteDraft(intact, {})).toBe(false)
    expect(shouldPromoteDraft({ ...intact, draft: false }, { title: 'Configurar API' })).toBe(false)
  })
})

describe('example documents', () => {
  it('flattens nested subtasks with portable parent keys', () => {
    const flat = flattenExampleTasks([
      { key: 'parent', title: 'Pai', subtasks: [{ key: 'child', title: 'Filha' }] },
    ])
    expect(flat.map((task) => ({ key: task.key, parent: task.parent }))).toEqual([
      { key: 'parent', parent: null },
      { key: 'child', parent: 'parent' },
    ])
  })
  it('parses a versioned document', () => {
    const document = ExampleDocument.parse({
      schemaVersion: 1,
      project: { slug: 'demo-shop', name: 'Demo Shop' },
      tasks: [{ key: 'shop-auth', title: 'Auth' }],
    })
    expect(document.tasks[0]?.key).toBe('shop-auth')
  })
})

describe('task from an environment', () => {
  it('reads the label, the branch and the namespace', () => {
    expect(taskIdFromLabel({ 'portta.task': '#42' })).toBe('42')
    expect(taskIdFromLabel({})).toBeNull()
    expect(taskIdFromBranch('feat/task-42-auth')).toBe('42')
    expect(taskIdFromBranch('task_7')).toBe('7')
    expect(taskIdFromBranch('fix/182-tcp')).toBeNull()
    expect(taskIdFromNamespace('shop-task42')).toBe('42')
    expect(taskIdFromNamespace('shop-issue42')).toBeNull()
  })
})
