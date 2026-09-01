import { DatabaseClient } from './client.ts'
import { ProjectsRepository } from './projects.ts'
import { SettingsRepository } from './settings.ts'

export class Database {
  readonly projects: ProjectsRepository
  readonly settings: SettingsRepository
  private readonly client: DatabaseClient

  private constructor(client: DatabaseClient) {
    this.client = client
    this.projects = new ProjectsRepository(client)
    this.settings = new SettingsRepository(client)
  }

  static open(url: string): Database {
    return new Database(DatabaseClient.open(url))
  }

  ping(): Promise<void> {
    return this.client.ping()
  }

  migrate() {
    return this.client.migrate()
  }

  close(): Promise<void> {
    return this.client.close()
  }
}

export type { ProjectRecord, SeenProject } from './client.ts'
