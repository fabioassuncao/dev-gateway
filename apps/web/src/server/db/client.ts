import postgres, { type JSONValue, type Sql } from 'postgres'
import { migrate, type AppliedMigration } from './migrate.ts'
import type { InstallationRecord, RepositoryRecord } from '../integrations/github/repositories.ts'
import type { StoredInstallation, StoredIssue, StoredRepository, SyncState } from './github.ts'
import type { IssueRecord } from '../integrations/github/issues.ts'

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

export interface WorkspaceRecord {
  id: string
  slug: string
  name: string
  description: string | null
  archived: boolean
  createdAt: Date
  updatedAt: Date
}

export interface WorkspaceRepositoryRow {
  workspaceId: string
  repositoryId: string
  fullName: string
  htmlUrl: string
  defaultBranch: string | null
  private: boolean
  archived: boolean
  role: string | null
  position: number
}

export interface IssueEnvironmentRow {
  issueId: string
  composeProject: string
  source: string
  branch: string | null
  worktreePath: string | null
  linkedAt: Date
}

export interface WorkspaceEnvironmentRow {
  workspaceId: string
  composeProject: string
  source: string
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

  // ---- the issue / environment link ---------------------------------------
  //
  // Linking writes one row. Nothing here starts, stops, creates or removes
  // anything, and nothing here writes to `projects` beyond referencing it.

  async listIssueEnvironments(): Promise<IssueEnvironmentRow[]> {
    return this.sql<IssueEnvironmentRow[]>`
      SELECT
        ie.issue_id::text AS "issueId",
        p.compose_project AS "composeProject",
        ie.source, ie.branch,
        ie.worktree_path AS "worktreePath",
        ie.linked_at AS "linkedAt"
      FROM issue_environments ie
      JOIN projects p ON p.id = ie.project_id
    `
  }

  async setIssueEnvironments(
    issueId: string,
    links: { composeProject: string; branch: string | null }[],
  ): Promise<void> {
    await this.sql.begin(async (transaction) => {
      await transaction`DELETE FROM issue_environments WHERE issue_id = ${issueId}`
      for (const link of links) {
        await transaction`
          INSERT INTO issue_environments (issue_id, project_id, source, branch)
          SELECT ${issueId}, p.id, 'manual', ${link.branch}
          FROM projects p WHERE p.compose_project = ${link.composeProject}
          ON CONFLICT (project_id) DO UPDATE SET
            issue_id = EXCLUDED.issue_id, source = 'manual', branch = EXCLUDED.branch
        `
      }
    })
  }

  // ---- workspaces ---------------------------------------------------------
  //
  // A workspace is the user's decision, so nothing on the snapshot path ever
  // writes here: `recordSeen()` touches `projects` and stops.

  async createWorkspace(input: { slug: string; name: string; description: string | null }): Promise<WorkspaceRecord> {
    const rows = await this.sql<WorkspaceRecord[]>`
      INSERT INTO workspaces (slug, name, description)
      VALUES (${input.slug}, ${input.name}, ${input.description})
      RETURNING
        id::text AS id, slug, name, description, archived,
        created_at AS "createdAt", updated_at AS "updatedAt"
    `
    const record = rows[0]
    if (record === undefined) throw new Error(`database did not return workspace ${input.slug}`)
    return record
  }

  /**
   * Every column is optional. `description` is deliberately three-valued: an
   * absent key leaves it alone, `null` clears it, and a string sets it, so
   * "no change" and "clear this" stay distinguishable.
   */
  async updateWorkspace(
    slug: string,
    patch: { name?: string; description?: string | null; archived?: boolean },
  ): Promise<WorkspaceRecord | null> {
    const clearDescription = Object.hasOwn(patch, 'description') && patch.description === null
    const rows = await this.sql<WorkspaceRecord[]>`
      UPDATE workspaces SET
        name = COALESCE(${patch.name ?? null}, name),
        description = CASE
          WHEN ${clearDescription} THEN NULL
          ELSE COALESCE(${patch.description ?? null}, description)
        END,
        archived = COALESCE(${patch.archived ?? null}, archived),
        updated_at = now()
      WHERE slug = ${slug}
      RETURNING id::text AS id, slug, name, description, archived,
        created_at AS "createdAt", updated_at AS "updatedAt"
    `
    return rows[0] ?? null
  }

  async listWorkspaces(): Promise<WorkspaceRecord[]> {
    return this.sql<WorkspaceRecord[]>`
      SELECT id::text AS id, slug, name, description, archived,
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM workspaces ORDER BY archived, name
    `
  }

  async findWorkspace(slug: string): Promise<WorkspaceRecord | null> {
    const rows = await this.sql<WorkspaceRecord[]>`
      SELECT id::text AS id, slug, name, description, archived,
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM workspaces WHERE slug = ${slug}
    `
    return rows[0] ?? null
  }

  /** Removes the grouping. It touches no container, no volume, no repository. */
  async deleteWorkspace(slug: string): Promise<boolean> {
    const rows = await this.sql<{ id: string }[]>`
      DELETE FROM workspaces WHERE slug = ${slug} RETURNING id::text AS id
    `
    return rows.length > 0
  }

  async listWorkspaceRepositories(): Promise<WorkspaceRepositoryRow[]> {
    return this.sql<WorkspaceRepositoryRow[]>`
      SELECT
        wr.workspace_id::text AS "workspaceId",
        gr.id::text AS "repositoryId",
        gr.full_name AS "fullName",
        gr.html_url AS "htmlUrl",
        gr.default_branch AS "defaultBranch",
        gr.private,
        gr.archived,
        wr.role,
        wr.position
      FROM workspace_repositories wr
      JOIN github_repositories gr ON gr.id = wr.repository_id
      ORDER BY wr.position, gr.full_name
    `
  }

  async setWorkspaceRepositories(
    workspaceId: string,
    repositories: { repositoryId: string; role: string | null }[],
  ): Promise<void> {
    await this.sql.begin(async (transaction) => {
      await transaction`DELETE FROM workspace_repositories WHERE workspace_id = ${workspaceId}`
      for (const [position, repository] of repositories.entries()) {
        await transaction`
          INSERT INTO workspace_repositories (workspace_id, repository_id, role, position)
          VALUES (${workspaceId}, ${repository.repositoryId}, ${repository.role}, ${position})
        `
      }
    })
  }

  async listWorkspaceEnvironments(): Promise<WorkspaceEnvironmentRow[]> {
    return this.sql<WorkspaceEnvironmentRow[]>`
      SELECT we.workspace_id::text AS "workspaceId", p.compose_project AS "composeProject", we.source
      FROM workspace_environments we
      JOIN projects p ON p.id = we.project_id
    `
  }

  async setWorkspaceEnvironments(workspaceId: string, composeProjects: string[]): Promise<void> {
    await this.sql.begin(async (transaction) => {
      await transaction`DELETE FROM workspace_environments WHERE workspace_id = ${workspaceId}`
      for (const composeProject of composeProjects) {
        await transaction`
          INSERT INTO workspace_environments (workspace_id, project_id, source)
          SELECT ${workspaceId}, p.id, 'manual' FROM projects p
          WHERE p.compose_project = ${composeProject}
          ON CONFLICT (project_id) DO UPDATE SET workspace_id = EXCLUDED.workspace_id, source = 'manual'
        `
      }
    })
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

  /**
   * What Portta itself stored about a Compose project. Used by removal
   * preview and by forgetProject. Nothing here talks to GitHub.
   */
  async projectRecordCounts(composeProject: string): Promise<ProjectRecordCounts> {
    const project = await this.findProject(composeProject)
    if (!project) return { overrides: 0, workspaceLinks: 0, issueLinks: 0 }
    const [settings, services, workspaces, issues] = await Promise.all([
      this.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM project_settings WHERE project_id = ${project.id}`,
      this.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM service_settings WHERE project_id = ${project.id}`,
      this.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM workspace_environments WHERE project_id = ${project.id}`,
      this.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM issue_environments WHERE project_id = ${project.id}`,
    ])
    return {
      overrides: (settings[0]?.n ?? 0) + (services[0]?.n ?? 0),
      workspaceLinks: workspaces[0]?.n ?? 0,
      issueLinks: issues[0]?.n ?? 0,
    }
  }

  /** Drops the project row. Settings, workspace links and issue links cascade. */
  async forgetProject(composeProject: string): Promise<ProjectRecordCounts> {
    const counts = await this.projectRecordCounts(composeProject)
    await this.sql`DELETE FROM projects WHERE compose_project = ${composeProject}`
    return counts
  }
}

export interface ProjectRecordCounts {
  overrides: number
  workspaceLinks: number
  issueLinks: number
}
