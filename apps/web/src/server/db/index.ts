import { DatabaseClient } from './client.ts'
import { GitHubRepository } from './github.ts'
import { EnvironmentsRepository } from './environments.ts'
import { ProjectsRepository } from './projects.ts'
import { RepositoriesRepository } from './repositories.ts'
import { SettingsRepository } from './settings.ts'
import { TasksRepository } from './tasks.ts'
import { SessionsRepository } from './sessions.ts'
import { ActivityRepository } from './activity.ts'

export interface DatabaseStatus {
  configured: boolean
  available: boolean
  reason: string | null
  checkedAt: number | null
  migrations: string[]
}

export class DatabaseUnavailable extends Error {
  readonly status = 503

  constructor(message = 'panel persistence is unavailable') {
    super(message)
    this.name = 'DatabaseUnavailable'
  }
}

export class Database {
  readonly environments: EnvironmentsRepository
  readonly projects: ProjectsRepository
  readonly repositories: RepositoriesRepository
  readonly settings: SettingsRepository
  readonly github: GitHubRepository
  readonly tasks: TasksRepository
  readonly sessions: SessionsRepository
  readonly activity: ActivityRepository
  private readonly client: DatabaseClient
  private initializing: Promise<void> | null = null
  private state: DatabaseStatus = {
    configured: true,
    available: false,
    reason: 'not checked yet',
    checkedAt: null,
    migrations: [],
  }

  private constructor(client: DatabaseClient) {
    this.client = client
    this.environments = new EnvironmentsRepository(client)
    this.projects = new ProjectsRepository(client)
    this.repositories = new RepositoriesRepository(client)
    this.settings = new SettingsRepository(client)
    this.github = new GitHubRepository(client)
    this.tasks = new TasksRepository(client)
    this.sessions = new SessionsRepository(client)
    this.activity = new ActivityRepository(client)
  }

  static open(url: string): Database {
    return new Database(DatabaseClient.open(url))
  }

  async initialize(): Promise<void> {
    if (this.initializing !== null) return this.initializing
    this.initializing = this.initializeOnce().finally(() => {
      this.initializing = null
    })
    return this.initializing
  }

  private async initializeOnce(): Promise<void> {
    try {
      const migrations = await this.client.migrate()
      await this.client.ping()
      this.markAvailable(migrations.map((migration) => migration.version))
    } catch (error) {
      this.markUnavailable(error)
      throw error
    }
  }

  /**
   * Apply every pending SQL file, even if this process already migrated at
   * start. A file that appeared after boot (the development bind-mount) is
   * otherwise invisible until the next restart.
   */
  async applyMigrations(): Promise<{ migrations: string[]; applied: string[] }> {
    const before = new Set(this.state.migrations)
    try {
      const rows = await this.client.migrate()
      await this.client.ping()
      const migrations = rows.map((row) => row.version)
      this.markAvailable(migrations)
      return { migrations, applied: migrations.filter((version) => !before.has(version)) }
    } catch (error) {
      this.markUnavailable(error)
      throw new DatabaseUnavailable(error instanceof Error ? error.message : String(error))
    }
  }

  async recordEnvironmentsSeen(
    environments: ReadonlyArray<{
      name: string
      workingDir: string | null
      repoUrl: string | null
      gitRoot: string | null
      /** The Compose files Docker recorded; remembered so `up` can run once the containers are gone. */
      operable?: { configFiles: string[] }
    }>,
  ): Promise<void> {
    try {
      // A database that was down during process startup is not abandoned.
      // The next Docker snapshot retries migrations under their advisory lock,
      // then records identity once persistence has recovered.
      if (!this.state.available) await this.initialize()
      await Promise.all(
        environments.map((environment) =>
          this.environments.upsertSeen({
            composeProject: environment.name,
            workingDir: environment.workingDir,
            configFiles: environment.operable?.configFiles ?? [],
            repoUrl: environment.repoUrl,
            repoSubpath: environment.gitRoot,
          }),
        ),
      )
      this.markAvailable(this.state.migrations)
    } catch (error) {
      this.markUnavailable(error)
    }
  }

  status(): DatabaseStatus {
    return { ...this.state, migrations: [...this.state.migrations] }
  }

  private markAvailable(migrations: string[]): void {
    this.state = {
      configured: true,
      available: true,
      reason: null,
      checkedAt: Math.floor(Date.now() / 1000),
      migrations,
    }
  }

  private markUnavailable(error: unknown): void {
    this.state = {
      ...this.state,
      available: false,
      reason: error instanceof Error ? error.message : String(error),
      checkedAt: Math.floor(Date.now() / 1000),
    }
  }

  close(): Promise<void> {
    return this.client.close()
  }
}

export function unavailableDatabaseStatus(configured: boolean, reason: string): DatabaseStatus {
  return { configured, available: false, reason, checkedAt: null, migrations: [] }
}

export function requireDatabase(database: Database | null): Database {
  if (database === null || !database.status().available) throw new DatabaseUnavailable()
  return database
}

export type { EnvironmentRecord, EnvironmentRecordCounts, SeenEnvironment, ProjectRecord } from './client.ts'
