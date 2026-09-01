# Panel persistence

The administration panel has an optional PostgreSQL database for durable
decisions: preferences, project metadata and integration configuration. It is
part of the panel, not part of the HTTP gateway and never stores runtime
observations as a source of truth.

## What is persisted

- one stable gateway instance identity;
- project identity and portable repository coordinates;
- the closed catalogue of global, project and service preferences;
- integration configuration.

Container state, health, ports, networks, URLs, logs, Git scans and Traefik
status still come from their live owners. A stopped container disappears from
the next Docker snapshot; PostgreSQL is not a stale inventory cache.

Most of that state is true only of this machine. [ADR 0016](adr/0016-state-that-could-be-shared.md)
classifies what could ever be shared between two gateways (project and user
decisions) and what must never be (runtime observations and instance
configuration). No synchronisation is implemented.

The first migration creates `instance`, `projects`, `settings`,
`project_settings`, `service_settings` and `integrations`. Applied migration
filenames are recorded in `schema_migrations`. Startup takes a transaction
scoped advisory lock and runs every pending migration in filename order, so
concurrent starts cannot partially apply one.

A later GitHub issue cache, if it is added, is a third category: not a
decision and not a Docker observation. [ADR 0018](adr/0018-github-access-lives-in-the-panel.md)
requires every projected row to record origin and age, and forbids treating
the cache as the only copy.

## Isolation and lifecycle

PostgreSQL uses the pinned image in `docker/compose/features/db.yaml`, a named volume and the
dedicated `dev-gateway-data` network. The network is `internal`; the database
publishes no host port and never joins the shared `dev-gateway` HTTP network.
`doctor` fails if either invariant is broken.

`dev-gateway web up` generates the database password in the git-ignored `.env`
when needed. The panel API reports only whether that setting exists and never
returns its value. `dev-gateway web down`, `dev-gateway down` and subsequent
`up` operations preserve the named volume.

PostgreSQL is deliberately a soft dependency. If it is unavailable, the panel
still starts and every Docker-backed page, `/api/health` and the existing API
surfaces keep working. Overview and diagnostics show a persistence warning;
only an operation that actually requires stored state returns 503.

## Operations

All clients run in an ephemeral toolbox container on the private data network.
The host needs no `psql`, and the password is inherited through the container
environment rather than placed in command arguments.

```bash
dev-gateway db status
dev-gateway db shell
dev-gateway db dump > dev-gateway.dump
dev-gateway db restore dev-gateway.dump
# or: dev-gateway --yes db restore < dev-gateway.dump
```

`db status` prints container health, the latest recorded migration and database
size. `db dump` writes a PostgreSQL custom-format archive and nothing else to
stdout. `db restore` uses `--clean --if-exists`, asks for confirmation and
restores ownership-neutral objects. Back up `.env` with the dump: the database
credential belongs to that file, not to the archive.

The similarly named `dev-gateway db psql --project ...` remains the client for
a consumer project's own PostgreSQL. `db shell`, `status`, `dump` and `restore`
refer specifically to the panel database.
