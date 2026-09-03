# Panel persistence

The administration panel has an optional PostgreSQL database for durable
decisions: preferences, project metadata and integration configuration. It is
part of the panel, not part of the HTTP gateway and never stores runtime
observations as a source of truth.

## What is persisted

Decisions, and a bounded history of the development flow:

- one stable gateway instance identity;
- **Projects** (`projects`): the product the operator recognises, its slug,
  description and its place under Projects Home; which environments it
  adopted (`project_environments`), and why;
- **Repositories** (`repositories`): a Project's git repositories, local
  first — a path, a remote, a role — with a GitHub repository as an optional
  binding;
- **Tasks** (`tasks`, `task_notes`, `task_environments`): Portta's own unit
  of work, with subtasks, notes and the environments a task is worked in;
  `task_github_links` binds a task to a projected issue and remembers
  whether the last local edit reached GitHub;
- **Development sessions** (`dev_sessions`): who worked on what, since when,
  and what came out;
- **Activity** (`activity_events`): what happened — a task moved, a session
  started, an environment rebuilt, a commit landed — pruned in code after
  ninety days or five thousand rows per Project;
- environment identity (`environments`, one row per `COMPOSE_PROJECT_NAME`
  ever seen, with `working_dir` and `config_files` as Docker last recorded
  them, so an environment whose containers are gone can be started again
  through the runner, or forgotten) and the closed catalogue of global,
  environment and service preferences (`settings`, `environment_settings`,
  `service_settings`);
- the GitHub projection (`github_installations`, `github_repositories`,
  `github_issues`, `github_issue_relationships`, `github_sync_state`): a
  cache of a remote source of truth, every row with its age.

Container state, health, ports, networks, URLs, logs, the repository scans
and Traefik status still come from their live owners. A stopped container
disappears from the next Docker snapshot; PostgreSQL is not a stale inventory
cache.

Most of that state is true only of this machine. [ADR 0016](adr/0016-state-that-could-be-shared.md)
classifies what could ever be shared between two gateways (project and user
decisions) and what must never be (runtime observations and instance
configuration). No synchronisation is implemented.

Migrations `0001` to `0013` build that schema; `0007` renamed the tables to
the words [ADR 0031](adr/0031-projects-home-and-project.md) chose,
`0008` to `0010` added repositories, tasks, sessions and activity, `0011`
added `config_files` to `environments`, and `0012` added task workspace
metadata. Migration `0013` adds sparse Kanban ranking, comment publication
state and activity source attribution. The original task migration turned
every existing issue of an owned repository into a bound task
([ADR 0032](adr/0032-portta-development-model.md)). Applied migration filenames
are recorded in `schema_migrations`. Startup takes a transaction scoped
advisory lock and runs every pending migration in filename order, so
concurrent starts cannot partially apply one; `portta db migrate` applies
what is pending without a restart.

## Isolation and lifecycle

PostgreSQL uses the pinned image in `docker/compose/features/db.yaml`, a named volume and the
dedicated `portta-data` network. The network is `internal`; the database
publishes no host port and never joins the shared `portta` HTTP network.
`doctor` fails if either invariant is broken.

`portta web up` generates the database password in the git-ignored `.env`
when needed. The panel API reports only whether that setting exists and never
returns its value. `portta web down`, `portta down` and subsequent
`up` operations preserve the named volume. `portta dev --reset` (or
`portta reset`) is the command that removes it and starts the checkout again;
development project volumes are not touched.

PostgreSQL is deliberately a soft dependency. If it is unavailable, the panel
still starts and every Docker-backed page, `/api/health` and the existing API
surfaces keep working. Overview and diagnostics show a persistence warning;
only an operation that actually requires stored state returns 503.

## Operations

All clients run in an ephemeral toolbox container on the private data network.
The host needs no `psql`, and the password is inherited through the container
environment rather than placed in command arguments.

```bash
portta db status
portta db migrate
portta db shell
portta db dump > portta.dump
portta db restore portta.dump
# or: portta --yes db restore < portta.dump
```

`db status` prints container health. `db migrate` asks the running panel to
apply every pending SQL file and is the command to run after adding a
migration while the panel is already up. `portta web up`, `portta web dev`
and `portta dev` do the same after the panel is healthy; a failure there is
a warning, because PostgreSQL is a soft dependency. The CLI never opens
PostgreSQL: it calls `POST /api/database/migrate`.

In a checkout, `docker/compose/features/web-dev.yaml` bind-mounts
`apps/web/migrations` into the API container so a new file is visible
without rebuilding the image. Production reads the files copied into the
image.

`db dump` writes a PostgreSQL custom-format archive and nothing else to
stdout. `db restore` uses `--clean --if-exists`, asks for confirmation and
restores ownership-neutral objects. Back up `.env` with the dump: the database
credential belongs to that file, not to the archive.

The similarly named `portta db psql --project ...` remains the client for
a consumer project's own PostgreSQL. `db shell`, `status`, `migrate`, `dump`
and `restore` refer specifically to the panel database.
