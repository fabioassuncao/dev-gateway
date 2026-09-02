// A task is an issue, asked about the way an agent asks.
//
// Nothing here is a second model. A task *is* a projected GitHub issue; what
// this module adds is the vocabulary an agent needs — "what should I do next",
// "I have started this", "I am done" — expressed over the same projection, the
// same adapter and the same authorisation boundary as the board.
//
// Everything in this file is a pure function of rows already read. The writes
// live in the routes, because a write is a network call and that is the routes'
// job; what is here is the part that can be tested without a database, a GitHub
// App or a clock.

import type { StoredIssue } from '../db/github.ts'
import { PRIORITIES, type Priority, type WorkflowStatus } from '../integrations/github/metadata.ts'

/**
 * How a task is named from outside.
 *
 * `owner/repo#number` is the coordinate a human or an agent already has — it is
 * in the branch name, the commit message and the URL — and requiring the
 * projected id would mean a lookup before every call. Both resolve through the
 * projection, so an unauthorised repository is refused identically either way.
 */
export type TaskRef =
  | { kind: 'coordinate'; repository: string; number: number }
  | { kind: 'id'; id: string }

const COORDINATE = /^([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)#(\d+)$/

export function parseTaskRef(raw: string): TaskRef | null {
  const value = decodeURIComponent(raw).trim()
  if (value === '') return null
  const coordinate = COORDINATE.exec(value)
  if (coordinate) {
    const number = Number(coordinate[2])
    if (!Number.isSafeInteger(number) || number <= 0) return null
    return { kind: 'coordinate', repository: coordinate[1]!, number }
  }
  // Anything else is a projected id. Refusing an id-shaped string here would
  // mean guessing at a format the database owns.
  return { kind: 'id', id: value }
}

/** Urgent first. `null` sorts last: unprioritised is not the same as low. */
const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

export function priorityRank(priority: string | null): number {
  return priority !== null && (PRIORITIES as readonly string[]).includes(priority)
    ? PRIORITY_RANK[priority as Priority]
    : PRIORITIES.length
}

/** Statuses a task can be picked up from. Nothing else is offered as "next". */
export const PICKABLE_STATUS: WorkflowStatus = 'ready'

export interface Relationship {
  parentId: string
  childId: string
}

/**
 * Whether a task cannot be started because something under it is not finished.
 *
 * A parent whose sub-issues are still open is not work: taking it would mean
 * doing the children, and the children are the tasks. Handing an agent the
 * parent is how two agents end up on the same code.
 */
export function isBlockedBySubtasks(task: StoredIssue, all: StoredIssue[], links: Relationship[]): boolean {
  const byId = new Map(all.map((issue) => [issue.id, issue]))
  return links
    .filter((link) => link.parentId === task.id)
    .some((link) => {
      const child = byId.get(link.childId)
      // A child outside the projection is not evidence that the parent is
      // ready; it is evidence the projection is incomplete, and refusing to
      // hand out the parent is the safe reading.
      return child === undefined || child.state !== 'closed'
    })
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
 *   2. it is open;
 *   3. nothing under it is unfinished;
 *   4. it is unassigned, or assigned to the caller;
 *   5. then by priority, urgent first, unprioritised last;
 *   6. then by how long it has waited — oldest `githubUpdatedAt` first, so a
 *      task nobody picks up rises rather than starving.
 */
export function nextTask(
  issues: StoredIssue[],
  links: Relationship[],
  options: NextTaskOptions = {},
): StoredIssue | null {
  const actor = options.actor ?? null
  const candidates = issues.filter((issue) =>
    !issue.isPullRequest &&
    issue.state !== 'closed' &&
    issue.workflowStatus === PICKABLE_STATUS &&
    (issue.assignees.length === 0 || (actor !== null && issue.assignees.includes(actor))) &&
    !isBlockedBySubtasks(issue, issues, links))

  if (candidates.length === 0) return null
  return candidates.sort((a, b) => {
    const byPriority = priorityRank(a.priority) - priorityRank(b.priority)
    if (byPriority !== 0) return byPriority
    const byAge = a.githubUpdatedAt.getTime() - b.githubUpdatedAt.getTime()
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
 * The sub-issue graph under one task, as a tree.
 *
 * The database already refuses a one-step cycle; this refuses a longer one by
 * never visiting a node twice, so a malformed graph produces a shorter tree
 * rather than a hang.
 */
export function subtaskTree<T extends { id: string }>(
  rootId: string,
  issues: T[],
  links: Relationship[],
  seen: Set<string> = new Set(),
): SubtaskNode<T>[] {
  if (seen.has(rootId)) return []
  seen.add(rootId)
  const byId = new Map(issues.map((issue) => [issue.id, issue]))
  return links
    .filter((link) => link.parentId === rootId)
    .flatMap((link) => {
      const child = byId.get(link.childId)
      if (!child) return []
      return [{ task: child, children: subtaskTree(link.childId, issues, links, seen) }]
    })
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
  status: WorkflowStatus
  /** `null` leaves the state alone; `closed` is only ever `finish`'s doing. */
  state: 'open' | 'closed' | null
  assignees: string[] | null
}

export function startPlan(current: StoredIssue, actor: string | null): TransitionPlan {
  return {
    status: 'in_progress',
    state: null,
    // Assigning is what makes `next_task` stop offering it to somebody else,
    // so it is part of starting rather than a separate call.
    assignees: actor && !current.assignees.includes(actor) ? [...current.assignees, actor] : null,
  }
}

export function finishPlan(close: boolean): TransitionPlan {
  return { status: 'done', state: close ? 'closed' : null, assignees: null }
}

/**
 * Who asked.
 *
 * Every write reaches GitHub as the App, so GitHub cannot tell an agent from a
 * person. `X-Portta-Actor` is recorded in the panel's own log line and never
 * forwarded, which answers "did I do that or did an agent" without inventing
 * an identity system the panel does not have.
 */
export function readActor(header: string | null | undefined): string | null {
  if (!header) return null
  const value = header.trim()
  if (value === '' || value.length > 64) return null
  return /^[A-Za-z0-9._-]+$/.test(value) ? value : null
}
