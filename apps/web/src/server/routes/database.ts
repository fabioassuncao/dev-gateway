import { Hono } from 'hono'
import type { AppDeps } from './deps.ts'
import { DatabaseUnavailable } from '../db/index.ts'
import { DatabaseMigrateResult } from '../../shared/types.ts'
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
    if (deps.db === null) throw new DatabaseUnavailable()
    return c.json(await deps.db.applyMigrations())
  })

  return app
}
