import postgres, { type JSONValue, type Sql } from 'postgres'
import { migrate, type AppliedMigration } from './migrate.ts'

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
