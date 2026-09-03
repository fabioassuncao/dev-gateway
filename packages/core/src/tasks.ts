// The vocabulary of work, in one place.
//
// A Task is Portta's own unit of work. It exists without GitHub; a GitHub issue
// is an optional binding on top of it. Everything here is a pure function over
// rows already read, so the panel (routes), the CLI and the MCP server share
// one definition of "what is next", "what is blocked" and "what a verb does".

export const TASK_STATUSES = ['backlog', 'ready', 'in_progress', 'review', 'blocked', 'done'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

/** Presentation and category live here so the UI never hardcodes a seventh status. */
export const TASK_STATUS_CATALOG = [
  { id: 'backlog', category: 'unstarted', tone: 'neutral', terminal: false },
  { id: 'ready', category: 'unstarted', tone: 'outline', terminal: false },
  { id: 'in_progress', category: 'started', tone: 'info', terminal: false },
  { id: 'review', category: 'started', tone: 'accent', terminal: false },
  { id: 'blocked', category: 'blocked', tone: 'danger', terminal: false },
  { id: 'done', category: 'done', tone: 'ok', terminal: true },
] as const satisfies ReadonlyArray<{ id: TaskStatus; category: string; tone: string; terminal: boolean }>

export type TaskStatusTone = (typeof TASK_STATUS_CATALOG)[number]['tone']
export type TaskStatusCategory = (typeof TASK_STATUS_CATALOG)[number]['category']

export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

export function statusDefinition(status: string): (typeof TASK_STATUS_CATALOG)[number] | undefined {
  return TASK_STATUS_CATALOG.find((entry) => entry.id === status)
}

/** Canonical title stored on a kick-created draft. The UI localises the display. */
export const TASK_DRAFT_TITLE = 'New task'
export const TASK_DRAFT_TITLES = ['New task', 'Nova tarefa'] as const
export const TASK_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000

export interface DraftLike {
  draft: boolean
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority | null
  type: string | null
  labels: readonly string[]
  assignee: string | null
  agent: string | null
  service: string | null
  dueAt?: Date | number | string | null
}

export function isDefaultDraftTitle(title: string): boolean {
  return (TASK_DRAFT_TITLES as readonly string[]).includes(title.trim())
}

export function isIntactDraft(task: DraftLike): boolean {
  return task.draft
    && isDefaultDraftTitle(task.title)
    && (task.description === null || task.description.trim() === '')
    && task.status === 'backlog'
    && task.priority === null
    && (task.type === null || task.type === '')
    && task.labels.length === 0
    && task.assignee === null
    && task.agent === null
    && (task.service === null || task.service === '')
    && (task.dueAt === null || task.dueAt === undefined)
}

export function shouldPromoteDraft(current: DraftLike, patch: Partial<DraftLike> = {}): boolean {
  if (!current.draft) return false
  const next: DraftLike = {
    ...current,
    labels: patch.labels ?? current.labels,
    title: patch.title ?? current.title,
    description: patch.description !== undefined ? patch.description : current.description,
  }
  if (patch.status !== undefined) next.status = patch.status
  if (patch.priority !== undefined) next.priority = patch.priority
  if (patch.type !== undefined) next.type = patch.type
  if (patch.assignee !== undefined) next.assignee = patch.assignee
  if (patch.agent !== undefined) next.agent = patch.agent
  if (patch.service !== undefined) next.service = patch.service
  if (patch.dueAt !== undefined) next.dueAt = patch.dueAt
  if (patch.draft !== undefined) next.draft = patch.draft
  return !isIntactDraft(next)
}

/**
 * What kind of work a task is.
 *
 * Unlike status and priority this stays a free-text column, because the values
 * arrive from elsewhere: a GitHub label, an imported plan, an agent writing
 * whatever the repository calls it. Forcing an enum would mean a migration
 * that throws away what those callers meant.
 *
 * What was missing was a vocabulary, so the same idea was spelled four ways
 * and coloured four ways. This is the recommended set: the panel offers it,
 * normalises the aliases that mean the same thing, and still renders a value
 * that is none of them.
 */
export const TASK_TYPE_CATALOG = [
  { id: 'feature', tone: 'accent', aliases: ['feat', 'features', 'enhancement-request', 'story'] },
  { id: 'bug', tone: 'danger', aliases: ['fix', 'bugfix', 'defect', 'regression'] },
  { id: 'improvement', tone: 'info', aliases: ['enhancement', 'refactor', 'perf', 'performance'] },
  { id: 'chore', tone: 'neutral', aliases: ['task', 'maintenance', 'build', 'ci', 'deps'] },
  { id: 'research', tone: 'agent', aliases: ['spike', 'investigation', 'discovery'] },
  { id: 'documentation', tone: 'outline', aliases: ['docs', 'doc'] },
] as const

export type TaskType = (typeof TASK_TYPE_CATALOG)[number]['id']
export const TASK_TYPES = TASK_TYPE_CATALOG.map((entry) => entry.id) as readonly TaskType[]

/**
 * The catalogued type a raw value means, or null when it means something this
 * vocabulary does not cover. Never rewrites the stored value: a task typed
 * "spike" keeps saying "spike" and is shown the way research is shown.
 */
export function taskTypeOf(raw: string | null | undefined): TaskType | null {
  if (!raw) return null
  const needle = raw.trim().toLowerCase().replace(/[\s_]+/g, '-')
  if (needle === '') return null
  for (const entry of TASK_TYPE_CATALOG) {
    if (entry.id === needle) return entry.id
    if ((entry.aliases as readonly string[]).includes(needle)) return entry.id
  }
  return null
}

export const TASK_SYNC_STATES = ['synced', 'pending', 'conflict', 'error'] as const
export type TaskSyncState = (typeof TASK_SYNC_STATES)[number]

export const ACTOR_KINDS = ['human', 'agent', 'system'] as const
export type ActorKind = (typeof ACTOR_KINDS)[number]

export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value)
}

export function isTaskPriority(value: string): value is TaskPriority {
  return (TASK_PRIORITIES as readonly string[]).includes(value)
}

/** Statuses that count as open work. Terminal entries in the catalog are closed. */
export function isOpenStatus(status: TaskStatus): boolean {
  return statusDefinition(status)?.terminal !== true
}

/**
 * How a task is named from outside.
 *
 * A local id is what the panel minted. `owner/repo#number` is the coordinate a
 * human or an agent already has when the task is bound to a GitHub issue: it is
 * in the branch name, the commit message and the URL.
 */
export type TaskRef =
  | { kind: 'coordinate'; repository: string; number: number }
  | { kind: 'id'; id: string }

const COORDINATE = /^([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)#(\d+)$/
const LOCAL_ID = /^[0-9]{1,18}$/

export function parseTaskRef(raw: string): TaskRef | null {
  let value: string
  try {
    value = decodeURIComponent(raw).trim()
  } catch {
    return null
  }
  if (value === '') return null
  const coordinate = COORDINATE.exec(value)
  if (coordinate) {
    const number = Number(coordinate[2])
    if (!Number.isSafeInteger(number) || number <= 0) return null
    return { kind: 'coordinate', repository: coordinate[1]!, number }
  }
  if (value.startsWith('#')) {
    const bare = value.slice(1)
    return LOCAL_ID.test(bare) ? { kind: 'id', id: bare } : null
  }
  return LOCAL_ID.test(value) ? { kind: 'id', id: value } : null
}

/** Urgent first. `null` sorts last: unprioritised is not the same as low. */
const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

export function priorityRank(priority: string | null | undefined): number {
  return priority != null && isTaskPriority(priority) ? PRIORITY_RANK[priority] : TASK_PRIORITIES.length
}

/** The one status a task can be picked up from. Nothing else is offered as "next". */
export const PICKABLE_STATUS: TaskStatus = 'ready'

/**
 * The minimum a scheduler needs to know about a task. Both a local row and a
 * projected GitHub issue can be mapped onto it.
 */
export interface SchedulableTask {
  id: string
  parentId: string | null
  status: TaskStatus | null
  priority: TaskPriority | null
  assignee: string | null
  /** Unix seconds since the task last moved; older waits first. */
  waitingSince: number
}

/**
 * Whether a task cannot be started because something under it is not finished.
 *
 * A parent whose subtasks are still open is not work: taking it would mean
 * doing the children, and the children are the tasks. Handing an agent the
 * parent is how two agents end up on the same code.
 */
export function isBlockedBySubtasks(task: SchedulableTask, all: readonly SchedulableTask[]): boolean {
  return all.some((candidate) => candidate.parentId === task.id && candidate.status !== 'done')
}

export interface NextTaskOptions {
  /** Skip tasks already assigned to somebody other than the caller. */
  actor?: string | null
}

/**
 * The task to do next, or null.
 *
 * Ordering, stated once so it can be tested and argued with:
 *
 *   1. status is `ready` — `backlog` is not triaged and `in_progress` is
 *      somebody's;
 *   2. nothing under it is unfinished;
 *   3. it is unassigned, or assigned to the caller;
 *   4. then by priority, urgent first, unprioritised last;
 *   5. then by how long it has waited, so a task nobody picks up rises rather
 *      than starving.
 */
export function nextTask<T extends SchedulableTask>(tasks: readonly T[], options: NextTaskOptions = {}): T | null {
  const actor = options.actor ?? null
  const candidates = tasks.filter((task) =>
    task.status === PICKABLE_STATUS &&
    (task.assignee === null || task.assignee === '' || (actor !== null && task.assignee === actor)) &&
    !isBlockedBySubtasks(task, tasks))
  if (candidates.length === 0) return null
  return [...candidates].sort((a, b) => {
    const byPriority = priorityRank(a.priority) - priorityRank(b.priority)
    if (byPriority !== 0) return byPriority
    const byAge = a.waitingSince - b.waitingSince
    if (byAge !== 0) return byAge
    // Deterministic on a tie, so two calls a second apart answer the same.
    return a.id.localeCompare(b.id)
  })[0] ?? null
}

export interface SubtaskNode<T> {
  task: T
  children: SubtaskNode<T>[]
}

/**
 * The subtask graph under one task, as a tree. Never visits a node twice, so
 * a malformed graph produces a shorter tree rather than a hang.
 */
export function subtaskTree<T extends { id: string; parentId: string | null }>(
  rootId: string,
  tasks: readonly T[],
  seen: Set<string> = new Set(),
): SubtaskNode<T>[] {
  if (seen.has(rootId)) return []
  seen.add(rootId)
  return tasks
    .filter((task) => task.parentId === rootId && !seen.has(task.id))
    .map((task) => ({ task, children: subtaskTree(task.id, tasks, seen) }))
}

/** Every node of a tree, flattened, parents before children. */
export function flattenSubtasks<T>(nodes: readonly SubtaskNode<T>[]): T[] {
  return nodes.flatMap((node) => [node.task, ...flattenSubtasks(node.children)])
}

/**
 * The transitions a task verb makes, in one place.
 *
 * `start` and `finish` are `status` with a name: they exist because "I have
 * started this" is what an agent means, and because doing it in one confirmed
 * write is the difference between a task that is taken and a task that is
 * half-taken.
 */
export interface TransitionPlan {
  status: TaskStatus
  /** `null` leaves the assignee alone. */
  assignee: string | null
  /** True only for `finish` with `close`, so a bound issue is closed on GitHub. */
  close: boolean
}

export function startPlan(current: { assignee: string | null }, actor: string | null): TransitionPlan {
  // Assigning is what makes `next_task` stop offering it to somebody else, so
  // it is part of starting rather than a separate call.
  return { status: 'in_progress', assignee: actor && current.assignee !== actor ? actor : null, close: false }
}

export function finishPlan(close: boolean): TransitionPlan {
  return { status: 'done', assignee: null, close }
}

/**
 * Who asked.
 *
 * `X-Portta-Actor` is self-declared: it is recorded, never verified, which
 * answers "did I do that or did an agent" without inventing an identity
 * system. An actor name is bounded and printable so it can go in a log line.
 */
export function readActor(header: string | null | undefined): string | null {
  if (!header) return null
  const value = header.trim()
  if (value === '' || value.length > 64) return null
  return /^[A-Za-z0-9._-]+$/.test(value) ? value : null
}

/**
 * Which environment a task is being worked in, from what the environment
 * itself declares. Pure: the panel supplies labels, branch and namespace.
 *
 * Order matters and first match wins: an explicit label beats a branch name,
 * and a branch name beats a namespace suffix.
 */
export const TASK_LABEL = 'portta.task'

export function taskIdFromLabel(labels: Record<string, string>): string | null {
  const raw = labels[TASK_LABEL]?.trim() ?? ''
  const bare = raw.startsWith('#') ? raw.slice(1) : raw
  return LOCAL_ID.test(bare) ? bare : null
}

export function taskIdFromBranch(branch: string | null): string | null {
  if (!branch) return null
  const match = /(?:^|\/)task[-_]?(\d{1,18})(?:[-_/]|$)/i.exec(branch)
  return match ? match[1]! : null
}

export function taskIdFromNamespace(namespace: string | null): string | null {
  if (!namespace) return null
  const match = /[-_]task(\d{1,18})$/i.exec(namespace)
  return match ? match[1]! : null
}

/**
 * What a sync should do with one bound task when the projection of its issue
 * changes. Pure, so the rule can be read here and tested without a database.
 *
 *   - no local edit since the last sync → the remote wins, quietly;
 *   - a pending local edit and a remote that did not move → the local edit is
 *     what still needs pushing, nothing to apply;
 *   - a pending local edit and a remote that moved past it → conflict: keep
 *     the local row, expose both, let a person decide.
 */
export type BindingVerdict = 'apply-remote' | 'keep-local' | 'conflict'

export function reconcileBinding(link: {
  syncState: TaskSyncState
  localUpdatedAt: number
  remoteUpdatedAt: number | null
}, remote: { updatedAt: number }): BindingVerdict {
  const remoteMoved = link.remoteUpdatedAt === null || remote.updatedAt > link.remoteUpdatedAt
  const localPending = link.syncState === 'pending' || link.syncState === 'conflict' || link.syncState === 'error'
  if (!localPending) return 'apply-remote'
  if (!remoteMoved) return 'keep-local'
  return 'conflict'
}

/** The fields a projected issue contributes to a task. One place, so the migration backfill and the sync agree. */
export interface IssueLikeForTask {
  title: string
  body: string | null
  state: 'open' | 'closed'
  workflowStatus: string | null
  priority: string | null
  issueType: string | null
  labels: readonly string[]
  assignees: readonly string[]
  updatedAt: number
}

export function taskFieldsFromIssue(issue: IssueLikeForTask): {
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority | null
  type: string | null
  labels: string[]
  assignee: string | null
  closedAt: number | null
} {
  const status = issue.workflowStatus !== null && isTaskStatus(issue.workflowStatus)
    ? issue.workflowStatus
    : issue.state === 'closed' ? 'done' : 'backlog'
  return {
    title: issue.title,
    description: issue.body,
    status: issue.state === 'closed' && status !== 'done' ? 'done' : status,
    priority: issue.priority !== null && isTaskPriority(issue.priority) ? issue.priority : null,
    type: issue.issueType,
    // The convention's own labels are the status and the priority, already read.
    labels: issue.labels.filter((label) => !/^(status|priority):/i.test(label)),
    assignee: issue.assignees[0] ?? null,
    closedAt: issue.state === 'closed' ? issue.updatedAt : null,
  }
}
