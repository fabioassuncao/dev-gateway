# Develop the database schema

The panel owns durable decisions; `packages/db` owns their schema.

## Where the schema lives

`packages/db` owns the schema, the migrations and the client, and holds no
business rule. `packages/server` owns the rules and reaches the tables through
it. The split is what lets a suite run the real migrations against an in-memory
PostgreSQL without starting a panel.

```text
packages/db/
├── drizzle/               0000_initial.sql and its journal — generated, never hand-written
├── drizzle.config.ts
└── src/
    ├── schema/            one file per area; the tables, checks, indexes and relations
    ├── client.ts          createDb(url) → { db, sql }
    ├── migrate.ts         migrateWithLock(url): advisory lock, then the migrator
    ├── seed.ts            seedMinimal(db): the instance row, and nothing else
    └── test-db.ts         createTestDb(): PGlite, migrated
```

## Changing the schema

The schema is TypeScript; the SQL is generated from it and committed.

```bash
# 1. edit packages/db/src/schema/*.ts
npm run db:generate --workspace=portta-db   # writes drizzle/NNNN_name.sql and its snapshot
# 2. read the SQL it produced, then commit both
npm run db:check --workspace=portta-db      # fails if the schema and the SQL disagree
```

Nothing in `packages/db/drizzle/` is written by hand. `db:check` runs the
generator and fails if it wanted to write anything, which is the only way to
notice a column added to the schema and never generated; `npm run test:integration` runs it in a disposable directory.

Applied migrations are recorded in `drizzle_migrations`. Startup takes a
session-level advisory lock and applies what is pending, so two panels starting
at once cannot partially apply one; a failure there is a failure to boot.
`portta db migrate` applies what is pending without a restart, which is what
makes a newly generated file visible to a panel that is already up.

There is one migration, `0000_initial`. The schema before it was replaced rather
than converted: what it held was a projection of Docker, GitHub and the host,
and it rebuilds itself. A volume from before the change is detected at boot —
`schema_migrations` present, `drizzle_migrations` absent — and the panel refuses
to start with the instruction to run `portta reset`.

In a checkout, `docker/compose/features/web-dev.yaml` bind-mounts
`packages/db/drizzle` into the panel container. `portta db migrate` requests
`POST /api/database/migrate`; it does not open a second database connection
from the CLI. Production reads the migrations packaged with that release.

## Testing against it

Suites open [PGlite](https://pglite.dev) — PostgreSQL compiled to WebAssembly —
and apply the same migrations. Checks, enums, cascades, advisory locks and
`jsonb` are the real ones, so a query the panel gets wrong fails in the suite
rather than in production.

```ts
import { createTestDb } from 'portta-db/testing'

const { db, close } = await createTestDb()
```

Create an isolated instance for each test and close it afterward. The test helper reuses an immutable migrated template within the test module; it never shares mutable database state. See [Testing](testing.md) for current guidance.
