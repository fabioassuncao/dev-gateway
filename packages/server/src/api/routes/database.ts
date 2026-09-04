import { Hono } from 'hono'
import type { AppDeps } from '../../deps.ts'
import { DatabaseMigrateResult } from 'portta-contracts'
import { documentRoute } from '../openapi.ts'

export function databaseRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  app.post('/database/migrate', documentRoute({
    tag: 'Configuration',
    operationId: 'postDatabaseMigrate', capability: 'gateway:read',
    summary: 'Apply pending panel SQL migrations',
    description:
      'Idempotent. The same work the process does at start, so a file that appeared after boot can be applied without a restart. The CLI never opens PostgreSQL.',
    response: DatabaseMigrateResult,
    errors: [403, 503],
  }), async (c) => {
    // Deliberately not behind `requireDatabase`: this is the endpoint that
    // *recovers* an unavailable database, so it runs against one and reports
    // 503 only if the run itself fails.
    return c.json(await deps.db.applyMigrations())
  })

  return app
}
