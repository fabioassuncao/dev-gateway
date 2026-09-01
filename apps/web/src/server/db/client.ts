import postgres, { type JSONValue, type Sql } from 'postgres'
import { migrate, type AppliedMigration } from './migrate.ts'
import type { InstallationRecord, RepositoryRecord } from '../integrations/github/repositories.ts'
import type { StoredInstallation, StoredRepository, SyncState } from './github.ts'

export interface ProjectRecord {
  id: string
  composeProject: string
  workingDir: string | null
  repoUrl: string | null
  repoSubpath: string | null
  slug: string | null
  displayName: string | null
  archived: boolean
  firstSeenAt: Date
  lastSeenAt: Date
  updatedAt: Date
}

export interface SeenProject {
  composeProject: string
  workingDir?: string | null
  repoUrl?: string | null
  repoSubpath?: string | null
  slug?: string | null
}

interface ValueRow {
  value: unknown
}

export interface ProjectSettingRow {
  composeProject: string
  key: string
  value: unknown
}

export interface ServiceSettingRow {
  composeProject: string
  service: string
  key: string
  value: unknown
}

export class DatabaseClient {
  private readonly sql: Sql

  constructor(sql: Sql) {
    this.sql = sql
  }

  static open(url: string): DatabaseClient {
    return new DatabaseClient(
      postgres(url, {
        max: 5,
        connect_timeout: 2,
        idle_timeout: 20,
        max_lifetime: 60 * 30,
        // Expected idempotent DDL (for example CREATE TABLE IF NOT EXISTS)
        // must not turn every panel restart into a noisy notice dump.
        onnotice: () => undefined,
      }),
    )
  }

  async ping(): Promise<void> {
    await this.sql`SELECT 1`
  }

  migrate(): Promise<AppliedMigration[]> {
    return migrate(this.sql)
  }

  close(): Promise<void> {
    return this.sql.end({ timeout: 2 })
  }

  async getGlobalSetting(key: string): Promise<unknown | null> {
    const rows = await this.sql<ValueRow[]>`SELECT value FROM settings WHERE key = ${key}`
    return rows[0]?.value ?? null
  }

  async setGlobalSetting(key: string, value: JSONValue): Promise<void> {
    await this.sql`
      INSERT INTO settings (key, value, updated_at)
      VALUES (${key}, ${this.sql.json(value)}, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `
  }

  async getProjectSetting(projectId: string, key: string): Promise<unknown | null> {
    const rows = await this.sql<ValueRow[]>`
      SELECT value FROM project_settings WHERE project_id = ${projectId} AND key = ${key}
    `
    return rows[0]?.value ?? null
  }

  async setProjectSetting(projectId: string, key: string, value: JSONValue): Promise<void> {
    await this.sql`
      INSERT INTO project_settings (project_id, key, value, updated_at)
      VALUES (${projectId}, ${key}, ${this.sql.json(value)}, now())
      ON CONFLICT (project_id, key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `
  }

  async getServiceSetting(projectId: string, service: string, key: string): Promise<unknown | null> {
    const rows = await this.sql<ValueRow[]>`
      SELECT value FROM service_settings
      WHERE project_id = ${projectId} AND service = ${service} AND key = ${key}
    `
    return rows[0]?.value ?? null
  }

  async setServiceSetting(projectId: string, service: string, key: string, value: JSONValue): Promise<void> {
    await this.sql`
      INSERT INTO service_settings (project_id, service, key, value, updated_at)
      VALUES (${projectId}, ${service}, ${key}, ${this.sql.json(value)}, now())
      ON CONFLICT (project_id, service, key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `
  }

  async deleteProjectSetting(projectId: string, key: string): Promise<void> {
    await this.sql`DELETE FROM project_settings WHERE project_id = ${projectId} AND key = ${key}`
  }

  async deleteServiceSetting(projectId: string, service: string, key: string): Promise<void> {
    await this.sql`
      DELETE FROM service_settings
      WHERE project_id = ${projectId} AND service = ${service} AND key = ${key}
    `
  }

  /**
   * Every override in one round trip, keyed by Compose project name.
   *
   * Decorating a snapshot must not cost one query per project: the panel
   * rebuilds the snapshot on every Docker event, and a per-project fan-out
   * would turn a quiet host into a busy database.
   */
  async listProjectSettings(): Promise<ProjectSettingRow[]> {
    return this.sql<ProjectSettingRow[]>`
      SELECT p.compose_project AS "composeProject", s.key, s.value
      FROM project_settings s
      JOIN projects p ON p.id = s.project_id
    `
  }

  async listServiceSettings(): Promise<ServiceSettingRow[]> {
    return this.sql<ServiceSettingRow[]>`
      SELECT p.compose_project AS "composeProject", s.service, s.key, s.value
      FROM service_settings s
      JOIN projects p ON p.id = s.project_id
    `
  }

  async findProject(composeProject: string): Promise<ProjectRecord | null> {
    const rows = await this.sql<ProjectRecord[]>`
      SELECT
        id::text AS id,
        compose_project AS "composeProject",
        working_dir AS "workingDir",
        repo_url AS "repoUrl",
        repo_subpath AS "repoSubpath",
        slug,
        display_name AS "displayName",
        archived,
        first_seen_at AS "firstSeenAt",
        last_seen_at AS "lastSeenAt",
        updated_at AS "updatedAt"
      FROM projects WHERE compose_project = ${composeProject}
    `
    return rows[0] ?? null
  }

  async upsertSeen(project: SeenProject): Promise<ProjectRecord> {
    const rows = await this.sql<ProjectRecord[]>`
      INSERT INTO projects (
        compose_project, working_dir, repo_url, repo_subpath, slug,
        first_seen_at, last_seen_at, updated_at
      ) VALUES (
        ${project.composeProject}, ${project.workingDir ?? null}, ${project.repoUrl ?? null},
        ${project.repoSubpath ?? null}, ${project.slug ?? null}, now(), now(), now()
      )
      ON CONFLICT (compose_project) DO UPDATE SET
        working_dir = COALESCE(EXCLUDED.working_dir, projects.working_dir),
        repo_url = COALESCE(EXCLUDED.repo_url, projects.repo_url),
        repo_subpath = COALESCE(EXCLUDED.repo_subpath, projects.repo_subpath),
        slug = COALESCE(EXCLUDED.slug, projects.slug),
        last_seen_at = now(),
        updated_at = now()
      RETURNING
        id::text AS id,
        compose_project AS "composeProject",
        working_dir AS "workingDir",
        repo_url AS "repoUrl",
        repo_subpath AS "repoSubpath",
        slug,
        display_name AS "displayName",
        archived,
        first_seen_at AS "firstSeenAt",
        last_seen_at AS "lastSeenAt",
        updated_at AS "updatedAt"
    `
    const record = rows[0]
    if (record === undefined) throw new Error(`database did not return project ${project.composeProject}`)
    return record
  }

  // ---- the GitHub projection ---------------------------------------------
  //
  // Idempotent by construction: running a sync twice leaves the same rows and
  // moves `synced_at`, which is what lets the UI say how old an answer is.

  async upsertGitHubInstallation(installation: InstallationRecord): Promise<void> {
    await this.sql`
      INSERT INTO github_installations (
        installation_id, account_login, account_type, target_id, suspended, permissions, synced_at
      ) VALUES (
        ${installation.installationId}, ${installation.accountLogin}, ${installation.accountType},
        ${installation.targetId}, ${installation.suspended},
        ${this.sql.json(installation.permissions as JSONValue)}, now()
      )
      ON CONFLICT (installation_id) DO UPDATE SET
        account_login = EXCLUDED.account_login,
        account_type = EXCLUDED.account_type,
        target_id = EXCLUDED.target_id,
        suspended = EXCLUDED.suspended,
        permissions = EXCLUDED.permissions,
        synced_at = now()
    `
  }

  async upsertGitHubRepository(repository: RepositoryRecord): Promise<void> {
    await this.sql`
      INSERT INTO github_repositories (
        github_id, node_id, installation_id, owner, name, full_name,
        default_branch, private, html_url, archived, synced_at
      ) VALUES (
        ${repository.githubId}, ${repository.nodeId}, ${repository.installationId},
        ${repository.owner}, ${repository.name}, ${repository.fullName},
        ${repository.defaultBranch}, ${repository.private}, ${repository.htmlUrl},
        ${repository.archived}, now()
      )
      ON CONFLICT (github_id) DO UPDATE SET
        node_id = EXCLUDED.node_id,
        installation_id = EXCLUDED.installation_id,
        owner = EXCLUDED.owner,
        name = EXCLUDED.name,
        full_name = EXCLUDED.full_name,
        default_branch = EXCLUDED.default_branch,
        private = EXCLUDED.private,
        html_url = EXCLUDED.html_url,
        archived = EXCLUDED.archived,
        synced_at = now()
    `
  }

  async listGitHubInstallations(): Promise<StoredInstallation[]> {
    return this.sql<StoredInstallation[]>`
      SELECT
        installation_id AS "installationId",
        account_login AS "accountLogin",
        account_type AS "accountType",
        target_id AS "targetId",
        suspended,
        permissions,
        synced_at AS "syncedAt"
      FROM github_installations
      ORDER BY account_login
    `
  }

  async listGitHubRepositories(): Promise<StoredRepository[]> {
    return this.sql<StoredRepository[]>`
      SELECT
        id::text AS id,
        github_id AS "githubId",
        node_id AS "nodeId",
        installation_id AS "installationId",
        owner, name,
        full_name AS "fullName",
        default_branch AS "defaultBranch",
        private,
        html_url AS "htmlUrl",
        archived,
        synced_at AS "syncedAt"
      FROM github_repositories
      ORDER BY full_name
    `
  }

  async findGitHubRepository(fullName: string): Promise<StoredRepository | null> {
    const rows = await this.sql<StoredRepository[]>`
      SELECT
        id::text AS id,
        github_id AS "githubId",
        node_id AS "nodeId",
        installation_id AS "installationId",
        owner, name,
        full_name AS "fullName",
        default_branch AS "defaultBranch",
        private,
        html_url AS "htmlUrl",
        archived,
        synced_at AS "syncedAt"
      FROM github_repositories WHERE full_name = ${fullName}
    `
    return rows[0] ?? null
  }

  async pruneGitHubRepositories(installationId: number, keep: number[]): Promise<number> {
    const rows = await this.sql<{ githubId: number }[]>`
      DELETE FROM github_repositories
      WHERE installation_id = ${installationId}
        AND ${keep.length === 0 ? this.sql`true` : this.sql`github_id <> ALL(${keep})`}
      RETURNING github_id AS "githubId"
    `
    return rows.length
  }

  async pruneGitHubInstallations(keep: number[]): Promise<number> {
    const rows = await this.sql<{ installationId: number }[]>`
      DELETE FROM github_installations
      WHERE ${keep.length === 0 ? this.sql`true` : this.sql`installation_id <> ALL(${keep})`}
      RETURNING installation_id AS "installationId"
    `
    return rows.length
  }

  async recordGitHubSync(scope: string, cursor: string | null, error: string | null): Promise<void> {
    await this.sql`
      INSERT INTO github_sync_state (scope, cursor, last_synced_at, last_error)
      VALUES (${scope}, ${cursor}, now(), ${error})
      ON CONFLICT (scope) DO UPDATE SET
        cursor = EXCLUDED.cursor,
        last_synced_at = EXCLUDED.last_synced_at,
        last_error = EXCLUDED.last_error
    `
  }

  async listGitHubSyncState(): Promise<SyncState[]> {
    return this.sql<SyncState[]>`
      SELECT scope, cursor, last_synced_at AS "lastSyncedAt", last_error AS "lastError"
      FROM github_sync_state ORDER BY scope
    `
  }

  async listProjects(): Promise<ProjectRecord[]> {
    return this.sql<ProjectRecord[]>`
      SELECT
        id::text AS id,
        compose_project AS "composeProject",
        working_dir AS "workingDir",
        repo_url AS "repoUrl",
        repo_subpath AS "repoSubpath",
        slug,
        display_name AS "displayName",
        archived,
        first_seen_at AS "firstSeenAt",
        last_seen_at AS "lastSeenAt",
        updated_at AS "updatedAt"
      FROM projects
      ORDER BY last_seen_at DESC, compose_project
    `
  }
}
