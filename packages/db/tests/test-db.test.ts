import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../src/test-db.ts'

describe('independent migrated databases', () => {
  it('restores schema, constraints and sequences without sharing rows or transactions', async () => {
    const [first, second] = await Promise.all([createTestDb(), createTestDb()])
    try {
      await first.db.execute(sql`CREATE TABLE snapshot_probe (id serial PRIMARY KEY, value jsonb NOT NULL)`)
      await first.db.execute(sql`INSERT INTO snapshot_probe (value) VALUES ('{"answer":42}')`)
      await expect(second.db.execute(sql`SELECT * FROM snapshot_probe`)).rejects.toThrow()
      await expect(first.db.transaction(async (tx) => {
        await tx.execute(sql`INSERT INTO snapshot_probe (value) VALUES ('{}')`)
        throw new Error('rollback')
      })).rejects.toThrow('rollback')
      const result = await first.db.execute<{ value: { answer: number } }>(sql`SELECT value FROM snapshot_probe`)
      expect(result.rows).toEqual([{ value: { answer: 42 } }])
      const tables = await second.db.execute(sql`SELECT * FROM projects`)
      expect(tables.rows).toEqual([])
    } finally {
      await Promise.all([first.close(), second.close()])
    }
    const third = await createTestDb()
    try {
      await expect(third.db.execute(sql`SELECT * FROM snapshot_probe`)).rejects.toThrow()
    } finally { await third.close() }
  })
})
