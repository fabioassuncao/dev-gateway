import { DatabaseClient } from './client.ts'
import { ProjectsRepository } from './projects.ts'
import { SettingsRepository } from './settings.ts'

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
  readonly projects: ProjectsRepository
  readonly settings: SettingsRepository
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
    this.projects = new ProjectsRepository(client)
    this.settings = new SettingsRepository(client)
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

  async recordSeen(
    projects: ReadonlyArray<{
      name: string
      workingDir: string | null
      repoUrl: string | null
      gitRoot: string | null
    }>,
  ): Promise<void> {
    try {
      // A database that was down during process startup is not abandoned.
      // The next Docker snapshot retries migrations under their advisory lock,
      // then records identity once persistence has recovered.
      if (!this.state.available) await this.initialize()
      await Promise.all(
        projects.map((project) =>
          this.projects.upsertSeen({
            composeProject: project.name,
            workingDir: project.workingDir,
            repoUrl: project.repoUrl,
            repoSubpath: project.gitRoot,
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

export type { ProjectRecord, SeenProject } from './client.ts'
