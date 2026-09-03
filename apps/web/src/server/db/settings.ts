import type { JSONValue } from 'postgres'
import type { DatabaseClient, EnvironmentSettingRow, ServiceSettingRow } from './client.ts'
import {
  globalSchema,
  environmentSchema,
  serviceSchema,
  type GlobalSettingKey,
  type GlobalSettingValues,
  type EnvironmentSettingKey,
  type EnvironmentSettingValues,
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

  async getEnvironment<K extends EnvironmentSettingKey>(environmentId: string, key: K): Promise<EnvironmentSettingValues[K] | null> {
    return validOrNull(environmentSchema(key), await this.client.getEnvironmentSetting(environmentId, key))
  }

  async setEnvironment<K extends EnvironmentSettingKey>(environmentId: string, key: K, value: EnvironmentSettingValues[K]): Promise<void> {
    const parsed = environmentSchema(key).parse(value) as JSONValue
    await this.client.setEnvironmentSetting(environmentId, key, parsed)
  }

  async getService<K extends ServiceSettingKey>(
    environmentId: string,
    service: string,
    key: K,
  ): Promise<ServiceSettingValues[K] | null> {
    return validOrNull(serviceSchema(key), await this.client.getServiceSetting(environmentId, service, key))
  }

  async setService<K extends ServiceSettingKey>(
    environmentId: string,
    service: string,
    key: K,
    value: ServiceSettingValues[K],
  ): Promise<void> {
    const parsed = serviceSchema(key).parse(value) as JSONValue
    await this.client.setServiceSetting(environmentId, service, key, parsed)
  }

  async clearEnvironment(environmentId: string, key: EnvironmentSettingKey): Promise<void> {
    await this.client.deleteEnvironmentSetting(environmentId, key)
  }

  async clearService(environmentId: string, service: string, key: ServiceSettingKey): Promise<void> {
    await this.client.deleteServiceSetting(environmentId, service, key)
  }

  /** Every stored override, in two queries rather than two per environment. */
  listAllEnvironment(): Promise<EnvironmentSettingRow[]> {
    return this.client.listEnvironmentSettings()
  }

  listAllService(): Promise<ServiceSettingRow[]> {
    return this.client.listServiceSettings()
  }
}
