# Tasks

A Portta task is local work. It belongs to a Project and may point at a
repository, an environment and a service. A GitHub issue is an optional
binding, never the row itself. See [ADR 0032](adr/0032-portta-development-model.md).

The workspace is `#/projects/:slug/tasks/:id`. Creating a task from the panel
is kick-create: **Nova tarefa** inserts a draft and opens that page. The title
starts as `New task` (shown localised). The first real edit promotes it. An
untouched draft stays off the board; a second click reopens it; intact drafts
older than 24 hours are removed.

`portta tasks create`, MCP and GitHub sync write published tasks.

## Status

The six statuses live in `TASK_STATUS_CATALOG` in `packages/core`. Each entry
has a tone, a category and whether it is terminal. The SQL check and the Zod
enum still list those six values. A later change can add per-project workflows
without rewriting the board.

## Import and export

Example stacks under `docker/examples/*/portta.example.json` are the first
consumers. The schema is versioned (`schemaVersion: 1`) and lives in
`packages/core` as `ExampleDocument`.

References are names: `repository`, `environment`, `service`, `parent`. Never
database ids. `key` is stored as `source_key` and is unique per project. A
second apply updates the same rows.

```bash
make dev
make demo-up          # optional: running stacks, not required for the import
make examples         # portta examples apply
```

`GET /api/projects/:slug/tasks/export` writes the same shape back. Tasks
without a `source_key` export as `task-<id>` so a later import can reconcile.

## GitHub binding

`task_github_links.sync_state` is `synced`, `pending`, `conflict` or `error`.

- No pending local edit → remote wins on the next sync.
- Pending local edit and a still remote → keep local.
- Both moved → `conflict`; resolve with `POST /tasks/:ref/github/sync` and
  `resolve: local|remote`.

Title, description, status, priority and assignee travel across the binding.
Notes, parent, agent, type, service, due date and draft do not. A draft cannot
be published to GitHub until it has a real title.

## Commits and a task

How Portta can tell which commits belong to a task, and how reliable each
signal is.

| Strategy | Reliability | Notes |
|---|---|---|
| `task → dev_sessions → commits[]` | High | The session carries `task_id` and `repository_id`. `commit-watch` appends new HEADs to the active session. This is the path agents already use (`portta sessions start --task`). |
| Explicit record at commit time | Highest | The same chain, written when the agent (or the host watcher) sees the commit, not reconstructed later. Prefer this. |
| Task id / `PORTTA-123` / `task:123` in the message | Low | Easy to omit, forge or collide. Useful as a fallback, not as the source of truth. |
| `#123` in the message | Low | Ambiguous once more than one GitHub repository is in play, and unused for local-only tasks. |
| Branch `task-42-*` | Medium | Already used to infer `task_environments`. Good for "this environment is for that task", weaker for every commit on a long-lived branch. |
| Linked GitHub issue + PR | Medium | Works when the task is bound and the PR is the unit of merge. Silent when GitHub is down or the work never opened a PR. |

**Local git, GitHub API, or both?** Both, with different jobs. `portta repos
scan` already collects the last twenty commits from the host without mounting
the tree into the panel. The GitHub API adds pull requests and remote-only
history. Neither replaces the session record.

**Agent commits.** An execution that starts as `task → session → repository`
should keep writing `dev_sessions.commits` (and `activity_events` of kind
`repository.commit`) as HEAD moves. Heuristics on the subject line are a
backfill for sessions that were not opened, not the primary design.

**A human-friendly task key (`BDH-42`).** Not minted yet. `#id` is already the
stable ref in the API, the CLI, MCP, `portta.task=#42` and branch names. A
prefix per project would help commit messages and chat, but it is a product
choice (slug? custom prefix? collision with GitHub `#n`) and can wait.

**Several repositories.** One session is one repository. A task that spans
repos is several sessions, aggregated on the task page the way it already
aggregates session commits today.

**What to show later.** Keep the current list (sha, subject, actor, age),
sourced from sessions first, then optionally from the scan / a bound PR. Do
not scrape every message looking for `#123` and present that as certainty.

## Follow-ups

Left out of this workspace on purpose, tracked as issues:

- [#40](https://github.com/fabioassuncao/portta/issues/40) — workflows per Project, on top of the catalog
- [#41](https://github.com/fabioassuncao/portta/issues/41) — a human-friendly key besides `#id`
- [#42](https://github.com/fabioassuncao/portta/issues/42) — a complete activity timeline
- [#43](https://github.com/fabioassuncao/portta/issues/43) — richer GitHub conflict resolution
- [#44](https://github.com/fabioassuncao/portta/issues/44) — commits bound through the session
- [#45](https://github.com/fabioassuncao/portta/issues/45) — import/export from the panel
