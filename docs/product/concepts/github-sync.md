# GitHub synchronization

Portta keeps local tasks and a projection of GitHub issues.

## The issue and the environment it is worked in

This is the join the rest of the sequence exists for. GitHub knows `#182` is
*In Progress* on branch `fix/182-tcp-proxy`. Only Portta knows that
branch is running as `base-empresarial-issue182`, with `web` and `api` on
`web.issue-182.localhost`, and what its logs say.

```text
#182 Proxy TCP perde conexão
Bug · Priority: High · Status: In Progress
Branch: fix/182-tcp-proxy · Environment: base-empresarial-issue182 (running)
web.issue-182.localhost   api.issue-182.localhost
```

**Linking writes one row.** It never starts, stops, creates or removes
anything.

### Inferred, then corrected, with the reason recorded

In order, first match wins:

| Source | Meaning |
|---|---|
| `manual` | You linked them in the panel. Always wins |
| `label` | The environment declares `portta.issue` as `owner/name#123`, or `#123` when the repository is unambiguous |
| `branch` | The branch matches `(feat\|fix\|chore\|…)/<number>-…`, `issue-<number>` or `<number>-…`, and the repository coordinate resolves |
| `namespace` | The Compose project or worktree ends in `issue<number>`, which is what `portta namespace` produces |

Each rule is a pure function over data the panel already has — no Docker call,
no GitHub call — so the UI can say *"linked because this environment is on
branch `fix/182-tcp-proxy`"* rather than presenting a mysterious association. A
coordinate that matches two projected issues links nothing and offers the
choice.

One issue may have several environments; an environment belongs to at most one
issue.

### Where it shows

- **On the issue**, an Environments section: each linked environment with its
  running count, its branch, its endpoints and a link straight into the project
  page's Logs tab. A linked environment that is not running says how to start it
  rather than showing an error — the panel never starts one for you.
- **On the environment**, a compact issue block on the project page's Overview
  tab: repository, number, title, type, priority, status, the reason for the
  link, and links to GitHub and to the panel.

`GET /api/projects/:project` gains a nullable `issue` block, so nothing that
read it before breaks. `GET /api/issues/:id` gains `environments`, and
`PUT /api/issues/:id/environments` is the manual link.

### What is deliberately not built

There is no `agent_runs` table. Nothing would write to it, and this project
persists decisions rather than speculation. Adding one later is
`CREATE TABLE agent_runs (… issue_id, project_id …)` and no change to anything
above; `issue_environments.worktree_path` is reserved for the same reason and is
null today.

## What stays on the host

`portta repos scan` still collects branch, HEAD, dirty counts and
ahead/behind from local `git`, and writes one `state/git/<key>.json` per
repository plus an index that maps each environment to its repository.
The panel only reads that snapshot. No project directory is mounted into
the panel. See [ADR 0010](../../development/adr/0010-git-collected-on-the-host.md).



## Panel responsibilities

A GitHub App, once configured, reads and writes issues, sub-issues, issue
types, issue fields and pull-request state. Local working trees stay
read-only. A Personal Access Token in `.env` is not the design.



## Source of truth

| Fact | Owner |
|---|---|
| Portta Task title, description, status, priority, labels and assignee | Portta. These fields can be copied explicitly across a GitHub binding; the local Task remains usable and authoritative when GitHub is unavailable |
| Agent, due date, parent, repository/environment/service, board rank and local comments | Portta only |
| GitHub issue state, milestone, field values, sub-issue links and pull-request state | GitHub, held as an external projection |
| Branch, HEAD, dirty counts, ahead/behind | Local `git` on the host |
| Containers, health, URLs, networks | Docker / Traefik on this host |
| Which GitHub repositories a Portta project owns | Portta |
| Which environments a Portta project has adopted | Portta |
| A link from an issue to an environment | Portta |

The panel never treats a Task as a cache of GitHub. A local write commits
first. When a binding exists, the shared fields are then pushed; an unavailable
GitHub leaves the binding `pending` or `error` and never rolls the Task back.
Linking an existing issue also requires an explicit first direction (`pull` or
`push`), so neither side silently wins. See [ADR 0033](../../development/adr/0033-tasks-are-local-issues.md).



## Projects: repositories and the environments that belong to them

A **Project** is the grouping a person creates. It owns repositories, adopts
environments, carries the board and — unlike an environment — does not
disappear when nothing is running. That is why it is persisted rather than
derived.

```text
Project  "Meu Produto"
├── repositories   api  (local clone, bound to acme/produto-api) · web (acme/produto-web)
└── environments   produto            (path)
                   produto-issue182   (repo-match)
```

A repository belongs to exactly one Project, and a monorepo is one
repository in one Project. `role` is free text with a documented vocabulary —
`api`, `web`, `mobile`, `services`, `infra`, `docs`, `other` — so adding one
later is not a migration. A repository exists without GitHub: a path under
Projects Home, or a remote, is enough. Binding it to a GitHub repository the
App was granted is what makes issues, pull-request state and the write-back
available for it.

### How an environment is adopted, and why

In order, first match wins:

| Source | Meaning |
|---|---|
| `manual` | You linked them in the panel. Always wins |
| `label` | The environment carries `portta.project: <slug>`. The project declared it, per ADR 0001 |
| `repo-match` | The environment's remote matches a repository this Project owns — applied **only when exactly one Project owns that coordinate** |
| `path` | The environment's working directory sits under the Project's directory, or under one of its repositories, and no other Project claims it |

The source is stored and shown, so the panel says *"adopted because it carries
`portta.project: meu-produto`"* rather than presenting a mapping with no
explanation. An ambiguous match adopts nothing and leaves the choice to you:
an automatic adoption that is wrong is worse than none.

An environment belongs to at most one Project; a Project may have any number,
including none.

### What the API keeps separate

`GET /api/projects` lists the product (the grouping). `GET /api/environments`
lists Compose stacks observed on this host.

`DELETE /api/projects/:slug` removes **the grouping and what only Portta
holds about it** — its repositories, tasks, sessions and activity rows: no
container is stopped, no volume is removed, no environment is changed, and no
repository is unlinked from GitHub. The response says so, because it is the
endpoint most likely to be misread.

Every Project endpoint needs the panel's database and answers `503` with a
hint when it is unavailable; writes are refused in read-only mode.



## Project, environment, repository

A **project** is a grouping a person creates. An **environment** is one
Compose project on this host (`COMPOSE_PROJECT_NAME`). A **repository**
is a GitHub repository bound to a project. Today's `projects` table is
the environment; renaming it is part of building the new project entity.

The Compose label `portta.project` remains a hint for grouping
worktrees. It does not silently create a Portta project.



## What is stored, and what is not

Stored, in the panel's own PostgreSQL:

- `github_installations` — which installations exist, for which account, with
  which permissions, and when they were last seen.
- `github_repositories` — the repositories those installations granted. This
  table is the authorisation boundary.
- `github_sync_state` — one row per sync scope, with its last run and its last
  error, so a failure is visible rather than silent.

Every row carries `synced_at`, so the UI can always say how old an answer is —
the same discipline the repository scan already applies.

**Never stored:** the private key, the webhook secret, and any installation
token. A token lives for an hour, is minted on demand, cached in memory with
its expiry and refreshed early. No code path writes one to a row, a log line or
an API response, and a test asserts that.



## Issues, and how they stay in step

Issues are **projected**: GitHub owns them, and the panel keeps a local copy so
the board answers while GitHub is unreachable. Every row carries `syncedAt` and
a staleness flag, exactly as `ProjectGit` carries `collectedAt` and `stale`.

GitHub comments are deliberately not projected wholesale. They are large, they change often, and
a link to GitHub beats a partial mirror — the same reasoning
[ADR 0010](../../development/adr/0010-git-collected-on-the-host.md) used for commit lists. There
is no `github_issue_comments` table and a test asserts there is not.

Portta comments are local entities. A user may explicitly publish one as a
copy to the bound GitHub issue. Portta records the returned comment id and URL,
and a failed publication remains retryable without losing the local comment.

### Issues and tasks

A **Task** is Portta's own unit of work; it exists without GitHub. An issue
on a repository a Project owns becomes a task bound to it — every existing
issue did so in the migration that introduced tasks, and a new one does on
the next reconciliation. The board, `portta tasks` and `portta mcp` all work
on tasks; `owner/repo#number` still addresses a bound one.

A write to a bound task is persisted in Portta first and then pushed. When the
App is unavailable the local write succeeds and the binding is marked
`pending` or `error` until `POST /api/tasks/:ref/github/sync` retries it. A remote
change that lands on a pending local edit is a `conflict`, kept and shown
with both sides; `sync` with `resolve: local | remote` settles it. Comments,
parent, agent, type, service, due date and draft stay local; a draft is
not published until it has a real title. See [Tasks](../guides/tasks.md) and
[ADR 0032](../../development/adr/0032-portta-development-model.md).

### Status and priority: fields where they exist, labels where they do not

Not every account has GitHub's native issue types and project fields, so status
and priority are read through one abstraction with two implementations. A
native field wins where the repository has one; otherwise a documented label
convention decides:

| Status | Label |
|---|---|
| Backlog | `status:backlog` |
| Ready | `status:ready` |
| In Progress | `status:in-progress` |
| Review | `status:review` |
| Blocked | `status:blocked` |
| Done | `status:done` |

| Priority | Label |
|---|---|
| Low | `priority:low` |
| Medium | `priority:medium` |
| High | `priority:high` |
| Urgent | `priority:urgent` |

No caller knows which mechanism was used — but **every response says which**,
in `metadataSource`, because it changes what a write does. Setting a status
through labels means adding one label and removing another, and that shows in
the issue's timeline. The panel marks a label-derived status so nobody is
surprised by it.

Only the dimension being changed is cleared, so setting a priority never
silently drops a status.

### What this does not read: GitHub Projects v2

`metadataSource` is `fields`, `labels` or `none`. Projects v2 fields are
**GraphQL-only**, and Portta has no GraphQL client, so a repository whose board
lives in a Project is invisible here — and worse, Portta's `status:*` label
writes will not move its cards, which is exactly the second source of truth
[ADR 0018](../../development/adr/0018-github-access-lives-in-the-panel.md) exists to forbid.

The seam for it is deliberate: `project` would be a fourth `MetadataSource`,
added *only when a real repository demands it*, together with the GraphQL client
it needs. Recorded as an extension point in ADR 0018's 2026-09-02 amendment, and
not a plan. Sub-issues and issue types are REST, and already in use.

### Three sync paths

| Path | When | How |
|---|---|---|
| **Initial** | A repository is newly authorised | Page through its issues, project them, then resolve sub-issue links in a second pass so a child seen before its parent is not lost |
| **Reconciliation** | On demand, and every `GITHUB_SYNC_INTERVAL_MINUTES` (default 15; `0` turns the timer off) | Ask only for issues updated since the stored cursor. Bounded per run; rate-limit pressure ends the run rather than failing it, and the next run resumes from the cursor. A tick that arrives while the previous pass is still running is skipped |
| **Webhook** | A delivery arrives | A signal to re-read, never data to trust |

`POST /api/integrations/github/sync` runs the repository sync and a
reconciliation pass: one button, one meaning. The timer calls the same
`reconcile`, so pressing the button is asking for the next pass now rather than
for something different.

The timer is what makes a **loopback panel** correct rather than merely
possible: it cannot receive a webhook delivery, so without it the projection is
only as fresh as the last time somebody pressed Sync. Turn it off with
`GITHUB_SYNC_INTERVAL_MINUTES=0` on a panel that does receive deliveries, where
it would otherwise do the same work twice.

### The webhook, and the hole it is allowed to make

The panel refuses every unsafe method without a same-origin `Origin` header.
GitHub sends none, so `POST /api/integrations/github/webhook` is exempt from
that guard — **narrowly, by exact path, and only because an HMAC signature over
the raw body replaces it**.

The signature is verified *before* the body is parsed as anything meaningful. An
invalid one is a `401` that logs the delivery id and nothing else. Read-only
mode still refuses the route, and a delivery for a repository the installation
never granted changes nothing: the projection is the boundary, and deliveries do
not widen it.

Handled events: `issues`, `label`, `milestone`, `sub_issues`, `pull_request`,
`repository`, `installation`, `installation_repositories`. Anything else —
including `issue_comment` — is acknowledged and dropped, and an unhandled event
is not an error.

Webhooks stay optional. A loopback panel cannot receive them, and correctness
comes from reconciliation — which now runs on a timer as well as on demand, so
"correctness comes from reconciliation" is a statement about what the panel does
rather than about what it could do. They are an optimisation for a panel you
have already published.

### Sub-issues

Sub-issue links come from GitHub's own API and are stored as a graph that
cannot cycle: the database refuses `a → a`, and a longer path is refused by
walking the graph before the row is written. A link whose parent is in a
repository the installation did not grant is dropped rather than dangling, so
the tree the UI renders always terminates.

### Writes go through GitHub

`PATCH /api/issues/:id` writes to GitHub and then updates the projection **from
what GitHub returned** — never from what was requested. The panel never shows an
issue GitHub did not confirm. It is refused in read-only mode, refused when no
App is configured, and refused for a repository outside the installation.

### What a status change actually does

| Provider | Moving a card to *Done* |
|---|---|
| Native fields | Sets the field. Nothing appears in the issue's timeline |
| Labels | Adds `status:done` and removes the previous `status:` label. **Both show in the timeline** |

The panel marks a label-derived status so the difference is visible before you
move anything, and only the dimension being changed is cleared: setting a
priority never silently drops a status.

### Pull requests: one source, stated

The host `gh` scan and the App can both report open pull requests. **When the
App is configured and the repository is authorised, the App wins**; otherwise
the scan's `forge` block stands exactly as it does today. A panel with no App
sees `GET /api/projects/:project/git` behave precisely as before.


See [GitHub synchronization](github-sync.md) for the data flow.
