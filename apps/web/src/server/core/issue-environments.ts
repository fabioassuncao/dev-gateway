// Joining the projection with what is actually running.
//
// The runtime half comes from the snapshot the panel already has, so it is
// current; the GitHub half comes from the projection and carries its age. The
// join itself is one table plus the inference in `issue-link.ts`.

import type { Snapshot } from './inventory.ts'
import { inferIssueLink, LINK_REASON, type IssueLinkSource } from './issue-link.ts'
import { repositoryCoordinate } from './adoption.ts'
import type { StoredIssue } from '../db/github.ts'
import type { Environment, EnvironmentIssue, IssueEnvironment } from '../../shared/types.ts'

export interface StoredIssueLink {
  issueId: string
  composeProject: string
  branch: string | null
}

export interface ResolvedLink {
  issueId: string
  source: IssueLinkSource
  reason: string
  branch: string | null
}

export function panelUrlFor(project: string): string {
  return `#/environments/${encodeURIComponent(project)}`
}

export function logsUrlFor(project: string): string {
  return `${panelUrlFor(project)}/logs`
}

/**
 * Which issue each running environment belongs to.
 *
 * Manual links win outright. Everything else is inferred from data the panel
 * already has, and only kept when the inferred coordinate resolves to exactly
 * one projected issue — an ambiguous match links nothing and lets the user say.
 */
export function resolveLinks(
  snapshot: Snapshot,
  issues: ReadonlyArray<StoredIssue>,
  manual: ReadonlyArray<StoredIssueLink>,
  branches: ReadonlyMap<string, string | null> = new Map(),
): Map<string, ResolvedLink> {
  const resolved = new Map<string, ResolvedLink>()

  const manualByProject = new Map(manual.map((link) => [link.composeProject, link]))
  const known = new Set(issues.map((issue) => issue.id))

  for (const project of snapshot.environments) {
    const stored = manualByProject.get(project.name)
    if (stored && known.has(stored.issueId)) {
      resolved.set(project.name, {
        issueId: stored.issueId,
        source: 'manual',
        reason: LINK_REASON.manual(
          { issue: { repository: null, number: 0 }, source: 'manual', branch: stored.branch },
          project.name,
        ),
        branch: stored.branch,
      })
      continue
    }

    const link = inferIssueLink({
      name: project.name,
      namespace: project.namespace,
      issueLabel: project.issueRef ?? null,
      branch: branches.get(project.name) ?? null,
      repository: repositoryCoordinate(project.repoUrl) ?? project.repo?.toLowerCase() ?? null,
    })
    if (link === null) continue

    const candidates = issues.filter(
      (issue) =>
        issue.number === link.issue.number &&
        (link.issue.repository === null || issue.repository.toLowerCase() === link.issue.repository),
    )
    if (candidates.length !== 1) continue

    resolved.set(project.name, {
      issueId: candidates[0]!.id,
      source: link.source,
      reason: LINK_REASON[link.source](link, project.name),
      branch: link.branch,
    })
  }

  return resolved
}

export function environmentsFor(
  issueId: string,
  snapshot: Snapshot,
  links: ReadonlyMap<string, ResolvedLink>,
): IssueEnvironment[] {
  const out: IssueEnvironment[] = []
  for (const project of snapshot.environments) {
    const link = links.get(project.name)
    if (!link || link.issueId !== issueId) continue
    out.push({
      project: project.name,
      source: link.source,
      reason: link.reason,
      running: project.runningCount > 0,
      serviceCount: project.serviceCount,
      runningCount: project.runningCount,
      unhealthyCount: project.unhealthyCount,
      urls: project.urls,
      branch: link.branch,
      panelUrl: panelUrlFor(project.name),
      logsUrl: logsUrlFor(project.name),
    })
  }
  return out
}

export function issueForEnvironment(
  project: Environment,
  issues: ReadonlyArray<StoredIssue>,
  links: ReadonlyMap<string, ResolvedLink>,
): EnvironmentIssue | null {
  const link = links.get(project.name)
  if (!link) return null
  const issue = issues.find((entry) => entry.id === link.issueId)
  if (!issue) return null

  return {
    id: issue.id,
    repository: issue.repository,
    number: issue.number,
    title: issue.title,
    state: issue.state === 'closed' ? 'closed' : 'open',
    issueType: issue.issueType,
    status: issue.workflowStatus,
    priority: issue.priority,
    source: link.source,
    reason: link.reason,
    htmlUrl: issue.htmlUrl,
    panelUrl: `#/issues/${encodeURIComponent(issue.id)}`,
    syncedAt: Math.floor(issue.syncedAt.getTime() / 1000),
  }
}
