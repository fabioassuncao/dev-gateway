// A real PostgreSQL, in memory, with the real migrations.
//
// PGlite is Postgres compiled to WebAssembly, so a suite gets checks, enums,
// cascades, advisory locks and `jsonb` — the things a hand-written fake was
// silently not testing. Each call owns an independent instance. Only an
// immutable image of the migrated schema is shared within a Vitest module.

import { PGlite } from '@electric-sql/pglite'
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { migrationsFolder, MIGRATIONS_TABLE } from './migrate.ts'
import * as schema from './schema/index.ts'

export type TestDb = PgliteDatabase<typeof schema>

export interface TestDatabase {
  db: TestDb
  close: () => Promise<void>
}

let migratedImage: Promise<Blob> | undefined

async function freshClient(): Promise<PGlite> {
  const client = new PGlite()
  try {
    await migrate(drizzle(client, { schema }), {
      migrationsFolder: migrationsFolder(),
      migrationsTable: MIGRATIONS_TABLE,
      migrationsSchema: 'public',
    })
    return client
  } catch (error) {
    await client.close()
    throw error
  }
}

async function image(): Promise<Blob> {
  const client = await freshClient()
  try {
    return await client.dumpDataDir('none')
  } finally {
    await client.close()
  }
}

export async function createTestDb(options: { fresh?: boolean } = {}): Promise<TestDatabase> {
  const client = options.fresh
    ? await freshClient()
    : await PGlite.create({ loadDataDir: await (migratedImage ??= image()) })
  return { db: drizzle(client, { schema }), close: () => client.close() }
}
