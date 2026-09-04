import type { DatabaseClient } from './client.ts'
import type { InstallationRecord, RepositoryRecord } from '../services/integrations/github/repositories.ts'
import type { IssueRecord } from '../services/integrations/github/issues.ts'

export interface StoredInstallation extends InstallationRecord {
  syncedAt: Date
}

export interface StoredRepository extends RepositoryRecord {
  id: string
  syncedAt: Date
}

export interface StoredIssue {
  id: string
  githubId: number
  nodeId: string
  repositoryId: string
  /** `owner/name`, joined so a card can be badged without a second query. */
  repository: string
  number: number
  title: string
  body: string | null
  state: string
  stateReason: string | null
  issueType: string | null
  workflowStatus: string | null
  priority: string | null
  metadataSource: string
  labels: string[]
  assignees: string[]
  milestone: { number: number | null; title: string; state: string } | null
  htmlUrl: string
  isPullRequest: boolean
  githubUpdatedAt: Date
  syncedAt: Date
}

export interface SyncState {
  scope: string
  cursor: string | null
  lastSyncedAt: Date | null
  lastError: string | null
}

/**
 * The projection, and only the projection.
 *
 * No method here accepts a token, and none returns one: an installation token
 * lives for an hour in memory and has no row to be written to.
 */
export class GitHubRepository {
  private readonly client: DatabaseClient

  constructor(client: DatabaseClient) {
    this.client = client
  }

  upsertInstallation(installation: InstallationRecord): Promise<void> {
    return this.client.upsertGitHubInstallation(installation)
  }

  upsertRepository(repository: RepositoryRecord): Promise<void> {
    return this.client.upsertGitHubRepository(repository)
  }

  listInstallations(): Promise<StoredInstallation[]> {
    return this.client.listGitHubInstallations()
  }

  listRepositories(): Promise<StoredRepository[]> {
    return this.client.listGitHubRepositories()
  }

  findRepository(fullName: string): Promise<StoredRepository | null> {
    return this.client.findGitHubRepository(fullName)
  }

  /** Removes what an installation no longer grants, so the boundary shrinks too. */
  pruneRepositories(installationId: number, keep: number[]): Promise<number> {
    return this.client.pruneGitHubRepositories(installationId, keep)
  }

  pruneInstallations(keep: number[]): Promise<number> {
    return this.client.pruneGitHubInstallations(keep)
  }

  upsertIssue(issue: IssueRecord): Promise<string> {
    return this.client.upsertGitHubIssue(issue)
  }

  listIssues(filter: { repositoryIds?: string[]; state?: string; limit?: number } = {}): Promise<StoredIssue[]> {
    return this.client.listGitHubIssues(filter)
  }

  findIssue(id: string): Promise<StoredIssue | null> {
    return this.client.findGitHubIssue(id)
  }

  findIssueByNumber(repositoryId: string, number: number): Promise<StoredIssue | null> {
    return this.client.findGitHubIssueByNumber(repositoryId, number)
  }

  listPullRequests(repositoryId: string): Promise<
    { number: number; title: string; state: string; htmlUrl: string }[]
  > {
    return this.client.listGitHubPullRequests(repositoryId)
  }

  replaceRelationships(
    repositoryId: string,
    links: { parentId: string; childId: string; position: number }[],
  ): Promise<void> {
    return this.client.replaceGitHubRelationships(repositoryId, links)
  }

  listRelationships(): Promise<{ parentId: string; childId: string; position: number }[]> {
    return this.client.listGitHubRelationships()
  }

  recordSync(scope: string, state: { cursor?: string | null; error?: string | null }): Promise<void> {
    return this.client.recordGitHubSync(scope, state.cursor ?? null, state.error ?? null)
  }

  listSyncState(): Promise<SyncState[]> {
    return this.client.listGitHubSyncState()
  }
}
