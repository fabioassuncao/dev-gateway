// One issue, as the API returns it.
//
// Extracted so `routes/issues.ts` and `routes/tasks.ts` cannot answer
// differently about the same row: the board and an agent look at one issue and
// must see one staleness flag, one metadata source and one set of environments.
//
// The assembly reads rows and the Docker snapshot. It makes no network call:
// branches come from the host Git scan the panel already reads.

import type { StoredIssue } from '../db/github.ts'
import type { Database } from '../db/index.ts'
import type { PanelConfig } from '../config.ts'
import type { Snapshot } from './inventory.ts'
import type { Issue } from '../../shared/types.ts'
import type { Priority, WorkflowStatus } from '../integrations/github/metadata.ts'
import { environmentsFor, resolveLinks, type ResolvedLink } from './issue-environments.ts'
import { readProjectGit } from './git.ts'

/** Past this age the projection is marked stale. It is still shown. */
export const STALE_AFTER_SECONDS = 900

function seconds(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

export function issueView(
  issue: StoredIssue,
  relationships: { parentId: string; childId: string }[],
  now: number,
  environments: Issue['environments'] = [],
): Issue {
  const syncedAt = seconds(issue.syncedAt)
  return {
    id: issue.id,
    repository: issue.repository,
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state === 'closed' ? 'closed' : 'open',
    stateReason: issue.stateReason,
    issueType: issue.issueType,
    status: issue.workflowStatus === null ? null : (issue.workflowStatus as WorkflowStatus),
    priority: issue.priority === null ? null : (issue.priority as Priority),
    metadataSource: (issue.metadataSource as 'fields' | 'labels' | 'none') ?? 'none',
    labels: issue.labels,
    assignees: issue.assignees,
    milestone: issue.milestone,
    htmlUrl: issue.htmlUrl,
    parentId: relationships.find((link) => link.childId === issue.id)?.parentId ?? null,
    childIds: relationships.filter((link) => link.parentId === issue.id).map((link) => link.childId),
    githubUpdatedAt: seconds(issue.githubUpdatedAt),
    syncedAt,
    stale: now - syncedAt > STALE_AFTER_SECONDS,
    environments,
  }
}

/**
 * Where each running environment belongs, resolved once per request.
 *
 * Branches come from the host Git scan the panel already reads, so nothing here
 * runs a command or makes a network call.
 */
export async function resolvedLinks(
  config: PanelConfig,
  db: Database,
  snapshot: Snapshot,
  issues: StoredIssue[],
): Promise<Map<string, ResolvedLink>> {
  const branches = new Map<string, string | null>(
    snapshot.projects.map((project) => [project.name, readProjectGit(config, project.name).git?.branch ?? null]),
  )
  const manual = (await db.github.listIssueEnvironments()).map((row) => ({
    issueId: row.issueId,
    composeProject: row.composeProject,
    branch: row.branch,
  }))
  return resolveLinks(snapshot, issues, manual, branches)
}

/**
 * Assemble several issues in one pass.
 *
 * The links and the snapshot are read once for the whole set: doing it per
 * issue turned a board of forty cards into forty Git reads.
 */
export async function issueViews(
  config: PanelConfig,
  db: Database,
  snapshot: Snapshot,
  issues: StoredIssue[],
  all?: StoredIssue[],
): Promise<Issue[]> {
  const corpus = all ?? issues
  const relationships = await db.github.listRelationships()
  const links = await resolvedLinks(config, db, snapshot, corpus)
  const now = Math.floor(Date.now() / 1000)
  return issues.map((issue) => issueView(issue, relationships, now, environmentsFor(issue.id, snapshot, links)))
}
