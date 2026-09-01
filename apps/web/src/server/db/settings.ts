import type { JSONValue } from 'postgres'
import type { DatabaseClient } from './client.ts'
import {
  globalSchema,
  projectSchema,
  serviceSchema,
  type GlobalSettingKey,
  type GlobalSettingValues,
  type ProjectSettingKey,
  type ProjectSettingValues,
  type ServiceSettingKey,
  type ServiceSettingValues,
} from './keys.ts'

function validOrNull<T>(schema: { safeParse(value: unknown): { success: boolean; data?: unknown } }, value: unknown): T | null {
  const parsed = schema.safeParse(value)
  return parsed.success ? (parsed.data as T) : null
}

export class SettingsRepository {
  private readonly client: DatabaseClient

  constructor(client: DatabaseClient) {
    this.client = client
  }

  async getGlobal<K extends GlobalSettingKey>(key: K): Promise<GlobalSettingValues[K] | null> {
    return validOrNull(globalSchema(key), await this.client.getGlobalSetting(key))
  }

  async setGlobal<K extends GlobalSettingKey>(key: K, value: GlobalSettingValues[K]): Promise<void> {
    const parsed = globalSchema(key).parse(value) as JSONValue
    await this.client.setGlobalSetting(key, parsed)
  }

  async getProject<K extends ProjectSettingKey>(projectId: string, key: K): Promise<ProjectSettingValues[K] | null> {
    return validOrNull(projectSchema(key), await this.client.getProjectSetting(projectId, key))
  }

  async setProject<K extends ProjectSettingKey>(projectId: string, key: K, value: ProjectSettingValues[K]): Promise<void> {
    const parsed = projectSchema(key).parse(value) as JSONValue
    await this.client.setProjectSetting(projectId, key, parsed)
  }

  async getService<K extends ServiceSettingKey>(
    projectId: string,
    service: string,
    key: K,
  ): Promise<ServiceSettingValues[K] | null> {
    return validOrNull(serviceSchema(key), await this.client.getServiceSetting(projectId, service, key))
  }

  async setService<K extends ServiceSettingKey>(
    projectId: string,
    service: string,
    key: K,
    value: ServiceSettingValues[K],
  ): Promise<void> {
    const parsed = serviceSchema(key).parse(value) as JSONValue
    await this.client.setServiceSetting(projectId, service, key, parsed)
  }
}
