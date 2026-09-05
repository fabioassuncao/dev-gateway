# Persistence

The administration panel keeps its durable decisions in PostgreSQL: preferences,
project metadata, tasks and integration configuration. It is part of the panel,
not part of the HTTP gateway, and it never stores runtime observations as a
source of truth.

**PostgreSQL is required.** A panel that starts without it can show Docker and
nothing else, and every write it accepts is lost, so it says what is missing and
exits instead. The managed mode selects `docker/compose/features/db.yaml` with the panel.
External mode selects the panel without the local database. Both modes authenticate
and apply migrations before the HTTP listener starts.

## What is persisted

Decisions, and a bounded history of the development flow:

- one stable gateway instance identity;
- **People and access** (`users`, `sessions`, `accounts`, `verifications`,
  `api_keys`, `two_factors`, `project_members`): who may sign in, and which
  Projects a `developer` or `viewer` can see. The tables exist from the first
  migration; the panel starts using them when authentication is turned on;
- **Projects** (`projects`): the product the operator recognises, its slug,
  description and its place under Projects Home; which environments it
  adopted (`project_environments`), and why;
- **Repositories** (`repositories`): a Project's git repositories, local
  first — a path, a remote, a role — with a GitHub repository as an optional
  binding;
- **Tasks** (`tasks`, `task_notes`, `task_attachments`, `task_environments`):
  Portta's own unit of work, with subtasks, notes, attached files and the
  environments a task is worked in; `task_github_links` binds a task to a
  projected issue and remembers whether the last local edit reached GitHub;
- **Work sessions** (`work_sessions`): who worked on what, since when,
  and what came out;
- **Activity** (`activity_events`): what happened — a task moved, a session
  started, an environment rebuilt, a commit landed — pruned in code after
  ninety days or five thousand rows per Project;
- **Audit** (`audit_log`): the sensitive writes — who signed in, who changed a
  role, who destroyed an environment — so "who did that" is answerable months
  later. Never a request body, a password, a hash or a token;
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
cache. `packages/db/tests/schema.test.ts` asserts that no table for any of them
exists.

Most of that state is true only of this machine. [ADR 0016](../../development/adr/0016-state-that-could-be-shared.md)
classifies what could ever be shared between two gateways (project and user
decisions) and what must never be (runtime observations and instance
configuration). No synchronisation is implemented.


## Isolation and lifecycle

PostgreSQL uses the pinned image in `docker/compose/features/db.yaml`, a named
volume and the dedicated `portta-data` network. The network is `internal`; the
database publishes no host port and never joins the shared `portta` HTTP
network. `doctor` fails if either invariant is broken.

`portta web up` generates the database password in the git-ignored `.env`
when needed. The panel API reports only whether that setting exists and never
returns its value. `portta web down`, `portta down` and subsequent
`up` operations preserve the named volume. `portta dev --reset` (or
`portta reset`) is the command that removes it and starts the checkout again;
development project volumes are not touched.

A connection that drops *after* boot is a different thing from a missing one:
the panel keeps serving every Docker-backed page, `/api/health` and the
existing read surfaces, Overview and diagnostics show a persistence warning,
and only an operation that needs stored state returns 503.


See [Back up and restore the panel](../guides/backup-restore.md) for operations and [Develop the database schema](../../development/database-development.md) for migrations.
