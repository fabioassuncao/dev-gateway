import postgres, { type JSONValue, type Sql } from 'postgres'
import { migrate, type AppliedMigration } from './migrate.ts'
import type { InstallationRecord, RepositoryRecord } from '../integrations/github/repositories.ts'
import type { StoredInstallation, StoredIssue, StoredRepository, SyncState } from './github.ts'
import type { IssueRecord } from '../integrations/github/issues.ts'

export interface EnvironmentRecord {
  id: string
  composeProject: string
  workingDir: string | null
  /** The Compose files as the daemon last recorded them; empty when never observed. */
  configFiles: string[]
  repoUrl: string | null
  repoSubpath: string | null
  firstSeenAt: Date
  lastSeenAt: Date
  updatedAt: Date
}

export interface SeenEnvironment {
  composeProject: string
  workingDir?: string | null
  /** Only a non-empty list overwrites: a stale row keeps its last known paths. */
  configFiles?: string[]
  repoUrl?: string | null
  repoSubpath?: string | null
}

interface ValueRow {
  value: unknown
}

export interface ProjectRecord {
  id: string
  slug: string
  name: string
  description: string | null
  archived: boolean
  /** First-level directory under Projects Home. Null when unmanaged / not yet placed. */
  relativePath: string | null
  createdAt: Date
  updatedAt: Date
}

export interface ProjectEnvironmentRow {
  projectId: string
  composeProject: string
  source: string
}

export interface EnvironmentSettingRow {
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

  /**
   * The handle, for repositories that own their own SQL (`db/repositories.ts`
   * and what follows it). This file keeps the environment and project core;
   * every later table gets its own module rather than another hundred lines
   * here.
   */
  get handle(): Sql {
    return this.sql
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

  async getEnvironmentSetting(environmentId: string, key: string): Promise<unknown | null> {
    const rows = await this.sql<ValueRow[]>`
      SELECT value FROM environment_settings WHERE environment_id = ${environmentId} AND key = ${key}
    `
    return rows[0]?.value ?? null
  }

  async setEnvironmentSetting(environmentId: string, key: string, value: JSONValue): Promise<void> {
    await this.sql`
      INSERT INTO environment_settings (environment_id, key, value, updated_at)
      VALUES (${environmentId}, ${key}, ${this.sql.json(value)}, now())
      ON CONFLICT (environment_id, key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `
  }

  async getServiceSetting(environmentId: string, service: string, key: string): Promise<unknown | null> {
    const rows = await this.sql<ValueRow[]>`
      SELECT value FROM service_settings
      WHERE environment_id = ${environmentId} AND service = ${service} AND key = ${key}
    `
    return rows[0]?.value ?? null
  }

  async setServiceSetting(environmentId: string, service: string, key: string, value: JSONValue): Promise<void> {
    await this.sql`
      INSERT INTO service_settings (environment_id, service, key, value, updated_at)
      VALUES (${environmentId}, ${service}, ${key}, ${this.sql.json(value)}, now())
      ON CONFLICT (environment_id, service, key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `
  }

  async deleteEnvironmentSetting(environmentId: string, key: string): Promise<void> {
    await this.sql`DELETE FROM environment_settings WHERE environment_id = ${environmentId} AND key = ${key}`
  }

  async deleteServiceSetting(environmentId: string, service: string, key: string): Promise<void> {
    await this.sql`
      DELETE FROM service_settings
      WHERE environment_id = ${environmentId} AND service = ${service} AND key = ${key}
    `
  }

  /**
   * Every override in one round trip, keyed by Compose project name.
   *
   * Decorating a snapshot must not cost one query per environment: the panel
   * rebuilds the snapshot on every Docker event, and a per-environment fan-out
   * would turn a quiet host into a busy database.
   */
  async listEnvironmentSettings(): Promise<EnvironmentSettingRow[]> {
    return this.sql<EnvironmentSettingRow[]>`
      SELECT e.compose_project AS "composeProject", s.key, s.value
      FROM environment_settings s
      JOIN environments e ON e.id = s.environment_id
    `
  }

  async listServiceSettings(): Promise<ServiceSettingRow[]> {
    return this.sql<ServiceSettingRow[]>`
      SELECT e.compose_project AS "composeProject", s.service, s.key, s.value
      FROM service_settings s
      JOIN environments e ON e.id = s.environment_id
    `
  }

  async findEnvironment(composeProject: string): Promise<EnvironmentRecord | null> {
    const rows = await this.sql<EnvironmentRecord[]>`
      SELECT
        id::text AS id,
        compose_project AS "composeProject",
        working_dir AS "workingDir",
        config_files AS "configFiles",
        repo_url AS "repoUrl",
        repo_subpath AS "repoSubpath",
        first_seen_at AS "firstSeenAt",
        last_seen_at AS "lastSeenAt",
        updated_at AS "updatedAt"
      FROM environments WHERE compose_project = ${composeProject}
    `
    return rows[0] ?? null
  }

  async upsertSeen(environment: SeenEnvironment): Promise<EnvironmentRecord> {
    const rows = await this.sql<EnvironmentRecord[]>`
      INSERT INTO environments (
        compose_project, working_dir, config_files, repo_url, repo_subpath,
        first_seen_at, last_seen_at, updated_at
      ) VALUES (
        ${environment.composeProject}, ${environment.workingDir ?? null}, ${environment.configFiles ?? []}::text[],
        ${environment.repoUrl ?? null}, ${environment.repoSubpath ?? null}, now(), now(), now()
      )
      ON CONFLICT (compose_project) DO UPDATE SET
        working_dir = COALESCE(EXCLUDED.working_dir, environments.working_dir),
        config_files = CASE
          WHEN cardinality(EXCLUDED.config_files) > 0 THEN EXCLUDED.config_files
          ELSE environments.config_files
        END,
        repo_url = COALESCE(EXCLUDED.repo_url, environments.repo_url),
        repo_subpath = COALESCE(EXCLUDED.repo_subpath, environments.repo_subpath),
        last_seen_at = now(),
        updated_at = now()
      RETURNING
        id::text AS id,
        compose_project AS "composeProject",
        working_dir AS "workingDir",
        config_files AS "configFiles",
        repo_url AS "repoUrl",
        repo_subpath AS "repoSubpath",
        first_seen_at AS "firstSeenAt",
        last_seen_at AS "lastSeenAt",
        updated_at AS "updatedAt"
    `
    const record = rows[0]
    if (record === undefined) throw new Error(`database did not return environment ${environment.composeProject}`)
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

  // ---- issues -------------------------------------------------------------

  async upsertGitHubIssue(issue: IssueRecord): Promise<string> {
    const rows = await this.sql<{ id: string }[]>`
      INSERT INTO github_issues (
        github_id, node_id, repository_id, number, title, body, state, state_reason,
        issue_type, workflow_status, priority, metadata_source, labels, assignees,
        milestone, html_url, is_pull_request, github_updated_at, synced_at
      ) VALUES (
        ${issue.githubId}, ${issue.nodeId}, ${issue.repositoryId}, ${issue.number},
        ${issue.title}, ${issue.body}, ${issue.state}, ${issue.stateReason},
        ${issue.issueType}, ${issue.workflowStatus}, ${issue.priority}, ${issue.metadataSource},
        ${this.sql.json(issue.labels as unknown as JSONValue)},
        ${this.sql.json(issue.assignees as unknown as JSONValue)},
        ${issue.milestone === null ? null : this.sql.json(issue.milestone as unknown as JSONValue)},
        ${issue.htmlUrl}, ${issue.isPullRequest}, ${issue.githubUpdatedAt}, now()
      )
      ON CONFLICT (github_id) DO UPDATE SET
        title = EXCLUDED.title,
        body = EXCLUDED.body,
        state = EXCLUDED.state,
        state_reason = EXCLUDED.state_reason,
        issue_type = EXCLUDED.issue_type,
        workflow_status = EXCLUDED.workflow_status,
        priority = EXCLUDED.priority,
        metadata_source = EXCLUDED.metadata_source,
        labels = EXCLUDED.labels,
        assignees = EXCLUDED.assignees,
        milestone = EXCLUDED.milestone,
        html_url = EXCLUDED.html_url,
        is_pull_request = EXCLUDED.is_pull_request,
        github_updated_at = EXCLUDED.github_updated_at,
        synced_at = now()
      RETURNING id::text AS id
    `
    return rows[0]!.id
  }

  private issueColumns() {
    return this.sql`
      i.id::text AS id,
      i.github_id AS "githubId",
      i.node_id AS "nodeId",
      i.repository_id::text AS "repositoryId",
      r.full_name AS "repository",
      i.number, i.title, i.body, i.state,
      i.state_reason AS "stateReason",
      i.issue_type AS "issueType",
      i.workflow_status AS "workflowStatus",
      i.priority,
      i.metadata_source AS "metadataSource",
      i.labels, i.assignees, i.milestone,
      i.html_url AS "htmlUrl",
      i.is_pull_request AS "isPullRequest",
      i.github_updated_at AS "githubUpdatedAt",
      i.synced_at AS "syncedAt"
    `
  }

  async listGitHubIssues(filter: {
    repositoryIds?: string[]
    state?: string
    limit?: number
  } = {}): Promise<StoredIssue[]> {
    const repositoryIds = filter.repositoryIds ?? null
    return this.sql<StoredIssue[]>`
      SELECT ${this.issueColumns()}
      FROM github_issues i
      JOIN github_repositories r ON r.id = i.repository_id
      WHERE i.is_pull_request = false
        AND ${repositoryIds === null ? this.sql`true` : this.sql`i.repository_id = ANY(${repositoryIds}::bigint[])`}
        AND ${filter.state === undefined ? this.sql`true` : this.sql`i.state = ${filter.state}`}
      ORDER BY i.github_updated_at DESC
      LIMIT ${Math.min(filter.limit ?? 200, 500)}
    `
  }

  async findGitHubIssue(id: string): Promise<StoredIssue | null> {
    const rows = await this.sql<StoredIssue[]>`
      SELECT ${this.issueColumns()}
      FROM github_issues i
      JOIN github_repositories r ON r.id = i.repository_id
      WHERE i.id = ${id}
    `
    return rows[0] ?? null
  }

  async findGitHubIssueByNumber(repositoryId: string, number: number): Promise<StoredIssue | null> {
    const rows = await this.sql<StoredIssue[]>`
      SELECT ${this.issueColumns()}
      FROM github_issues i
      JOIN github_repositories r ON r.id = i.repository_id
      WHERE i.repository_id = ${repositoryId} AND i.number = ${number}
    `
    return rows[0] ?? null
  }

  /** Pull requests arrive through the issues endpoint and are flagged there. */
  async listGitHubPullRequests(repositoryId: string): Promise<
    { number: number; title: string; state: string; htmlUrl: string }[]
  > {
    return this.sql<{ number: number; title: string; state: string; htmlUrl: string }[]>`
      SELECT number, title, state, html_url AS "htmlUrl"
      FROM github_issues
      WHERE repository_id = ${repositoryId} AND is_pull_request = true AND state = 'open'
      ORDER BY number
    `
  }

  async replaceGitHubRelationships(
    repositoryId: string,
    links: { parentId: string; childId: string; position: number }[],
  ): Promise<void> {
    await this.sql.begin(async (transaction) => {
      await transaction`
        DELETE FROM github_issue_relationships
        WHERE parent_id IN (SELECT id FROM github_issues WHERE repository_id = ${repositoryId})
      `
      for (const link of links) {
        await transaction`
          INSERT INTO github_issue_relationships (parent_id, child_id, position)
          VALUES (${link.parentId}, ${link.childId}, ${link.position})
          ON CONFLICT (parent_id, child_id) DO UPDATE SET position = EXCLUDED.position
        `
      }
    })
  }

  async listGitHubRelationships(): Promise<{ parentId: string; childId: string; position: number }[]> {
    return this.sql<{ parentId: string; childId: string; position: number }[]>`
      SELECT parent_id::text AS "parentId", child_id::text AS "childId", position
      FROM github_issue_relationships ORDER BY position
    `
  }

  // ---- projects -----------------------------------------------------------
  //
  // A Project is the operator's decision, so nothing on the snapshot path ever
  // writes here: `recordEnvironmentsSeen()` touches `environments` and stops.

  async createProject(input: { slug: string; name: string; description: string | null; relativePath?: string | null }): Promise<ProjectRecord> {
    const rows = await this.sql<ProjectRecord[]>`
      INSERT INTO projects (slug, name, description, relative_path)
      VALUES (${input.slug}, ${input.name}, ${input.description}, ${input.relativePath ?? null})
      RETURNING
        id::text AS id, slug, name, description, archived,
        relative_path AS "relativePath",
        created_at AS "createdAt", updated_at AS "updatedAt"
    `
    const record = rows[0]
    if (record === undefined) throw new Error(`database did not return project ${input.slug}`)
    return record
  }

  /**
   * Every column is optional. `description` is deliberately three-valued: an
   * absent key leaves it alone, `null` clears it, and a string sets it, so
   * "no change" and "clear this" stay distinguishable.
   */
  async updateProject(
    slug: string,
    patch: { name?: string; description?: string | null; archived?: boolean; relativePath?: string | null },
  ): Promise<ProjectRecord | null> {
    const clearDescription = Object.hasOwn(patch, 'description') && patch.description === null
    const clearPath = Object.hasOwn(patch, 'relativePath') && patch.relativePath === null
    const rows = await this.sql<ProjectRecord[]>`
      UPDATE projects SET
        name = COALESCE(${patch.name ?? null}, name),
        description = CASE
          WHEN ${clearDescription} THEN NULL
          ELSE COALESCE(${patch.description ?? null}, description)
        END,
        archived = COALESCE(${patch.archived ?? null}, archived),
        relative_path = CASE
          WHEN ${clearPath} THEN NULL
          ELSE COALESCE(${patch.relativePath ?? null}, relative_path)
        END,
        updated_at = now()
      WHERE slug = ${slug}
      RETURNING id::text AS id, slug, name, description, archived,
        relative_path AS "relativePath",
        created_at AS "createdAt", updated_at AS "updatedAt"
    `
    return rows[0] ?? null
  }

  async listProjects(): Promise<ProjectRecord[]> {
    return this.sql<ProjectRecord[]>`
      SELECT id::text AS id, slug, name, description, archived,
             relative_path AS "relativePath",
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM projects ORDER BY archived, name
    `
  }

  async findProject(slug: string): Promise<ProjectRecord | null> {
    const rows = await this.sql<ProjectRecord[]>`
      SELECT id::text AS id, slug, name, description, archived,
             relative_path AS "relativePath",
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM projects WHERE slug = ${slug}
    `
    return rows[0] ?? null
  }

  /** Removes the grouping. It touches no container, no volume, no repository. */
  async deleteProject(slug: string): Promise<boolean> {
    const rows = await this.sql<{ id: string }[]>`
      DELETE FROM projects WHERE slug = ${slug} RETURNING id::text AS id
    `
    return rows.length > 0
  }

  async listProjectEnvironments(): Promise<ProjectEnvironmentRow[]> {
    return this.sql<ProjectEnvironmentRow[]>`
      SELECT pe.project_id::text AS "projectId", e.compose_project AS "composeProject", pe.source
      FROM project_environments pe
      JOIN environments e ON e.id = pe.environment_id
    `
  }

  async setProjectEnvironments(projectId: string, composeProjects: string[]): Promise<void> {
    await this.sql.begin(async (transaction) => {
      await transaction`DELETE FROM project_environments WHERE project_id = ${projectId}`
      for (const composeProject of composeProjects) {
        await transaction`
          INSERT INTO project_environments (project_id, environment_id, source)
          SELECT ${projectId}, e.id, 'manual' FROM environments e
          WHERE e.compose_project = ${composeProject}
          ON CONFLICT (environment_id) DO UPDATE SET project_id = EXCLUDED.project_id, source = 'manual'
        `
      }
    })
  }

  async listEnvironments(): Promise<EnvironmentRecord[]> {
    return this.sql<EnvironmentRecord[]>`
      SELECT
        id::text AS id,
        compose_project AS "composeProject",
        working_dir AS "workingDir",
        config_files AS "configFiles",
        repo_url AS "repoUrl",
        repo_subpath AS "repoSubpath",
        first_seen_at AS "firstSeenAt",
        last_seen_at AS "lastSeenAt",
        updated_at AS "updatedAt"
      FROM environments
      ORDER BY last_seen_at DESC, compose_project
    `
  }

  /**
   * What Portta itself stored about an environment. Used by removal preview
   * and by forgetEnvironment. Nothing here talks to GitHub.
   */
  async environmentRecordCounts(composeProject: string): Promise<EnvironmentRecordCounts> {
    const environment = await this.findEnvironment(composeProject)
    if (!environment) return { overrides: 0, projectLinks: 0, issueLinks: 0 }
    const [settings, services, projects, issues] = await Promise.all([
      this.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM environment_settings WHERE environment_id = ${environment.id}`,
      this.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM service_settings WHERE environment_id = ${environment.id}`,
      this.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM project_environments WHERE environment_id = ${environment.id}`,
      this.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM task_environments WHERE environment_id = ${environment.id}`,
    ])
    return {
      overrides: (settings[0]?.n ?? 0) + (services[0]?.n ?? 0),
      projectLinks: projects[0]?.n ?? 0,
      issueLinks: issues[0]?.n ?? 0,
    }
  }

  /** Drops the environment row. Settings, project links and issue links cascade. */
  async forgetEnvironment(composeProject: string): Promise<EnvironmentRecordCounts> {
    const counts = await this.environmentRecordCounts(composeProject)
    await this.sql`DELETE FROM environments WHERE compose_project = ${composeProject}`
    return counts
  }
}

export interface EnvironmentRecordCounts {
  overrides: number
  projectLinks: number
  issueLinks: number
}
