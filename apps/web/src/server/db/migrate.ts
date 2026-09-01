import { readdirSync, readFileSync } from 'node:fs'
import type { Sql } from 'postgres'

const MIGRATION_LOCK = 7_238_472_364
const DEFAULT_DIRECTORY = new URL('../../../migrations/', import.meta.url)

export interface AppliedMigration {
  version: string
  appliedAt: Date
}

export async function migrate(sql: Sql, directory: URL = DEFAULT_DIRECTORY): Promise<AppliedMigration[]> {
  return sql.begin(async (transaction) => {
    // A transaction-scoped lock covers discovery, DDL and recording. Two panel
    // containers either see the whole migration set or wait for it; no manual
    // unlock path can be skipped by a crashed process.
    await transaction`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK})`
    await transaction`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `

    const applied = await transaction<{ version: string }[]>`
      SELECT version FROM schema_migrations ORDER BY version
    `
    const known = new Set(applied.map((row) => row.version))
    const files = readdirSync(directory, { encoding: 'utf8' })
      .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
      .sort()

    for (const version of files) {
      if (known.has(version)) continue
      const source = readFileSync(new URL(version, directory), 'utf8')
      await transaction.unsafe(source)
      await transaction`INSERT INTO schema_migrations (version) VALUES (${version})`
    }

    const rows = await transaction<{ version: string; appliedAt: Date }[]>`
      SELECT version, applied_at AS "appliedAt"
      FROM schema_migrations
      ORDER BY version
    `
    return rows.map((row) => ({ version: row.version, appliedAt: row.appliedAt }))
  })
}
