import type { DatabaseClient } from './client.ts'
import type { InstallationRecord, RepositoryRecord } from '../integrations/github/repositories.ts'

export interface StoredInstallation extends InstallationRecord {
  syncedAt: Date
}

export interface StoredRepository extends RepositoryRecord {
  id: string
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

  recordSync(scope: string, state: { cursor?: string | null; error?: string | null }): Promise<void> {
    return this.client.recordGitHubSync(scope, state.cursor ?? null, state.error ?? null)
  }

  listSyncState(): Promise<SyncState[]> {
    return this.client.listGitHubSyncState()
  }
}
