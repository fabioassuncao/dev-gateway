# 0018. GitHub access lives in the panel, through a GitHub App

**Status:** Accepted

Issue #17 asked for ADR 0013. That number was already taken by
[ADR 0013](0013-what-the-panel-persists.md) (what the panel persists) and
0017 by [ADR 0017](0017-no-docker-sdk.md). This is 0018.

This record decides where GitHub access runs and what it costs. **No App,
no dependency, no route and no table ships from the change that accepts
it.** Implementation is issues #18–#22.

## Context

[ADR 0010](0010-git-collected-on-the-host.md) considered calling the GitHub
API from the panel and rejected it: a long-lived credential in a file the
panel itself can write, egress from a container that has none today, and
our own rate-limit accounting. It closed with:

> Read-only, in both directions. No checkout, merge, rebase, reset, stash,
> fetch or push; no PR approval or merge; **no webhook**; no write to any
> repository. The gateway observes environments, it does not drive them.

A GitHub App that reads and writes issues, receives webhooks and moves
cards on a board reverses that last sentence. The repository's own
convention is to settle that on paper first.

The ambition is a development control plane: projects, repositories,
GitHub issues, workspaces, Docker environments and, later, coding agents.
This record says only enough about agents and worktrees to avoid
foreclosing them. It does not design a task runner.

Checked against GitHub's REST API on 2026-09-01, `X-GitHub-Api-Version:
2026-03-10`. Sub-issues, organisation issue types and issue field values
are generally available endpoints, not previews. Installation access
tokens expire after one hour. From April 2026 GitHub has been rolling out
a longer stateless token format (`ghs_APPID_JWT`); nothing here may assume
a 40-character token.

## What this record contradicts in earlier ADRs

| Record | Sentence | This record |
|---|---|---|
| ADR 0010 | "Calling the GitHub API from the panel with a token in `.env`" is rejected | **Stands** for a PAT. A GitHub App private key is a different secret class, and it is not a `.env` value |
| ADR 0010 | Local `git` is collected on the host; the panel only reads `state/git/` | **Stands** |
| ADR 0010 | No project directory is mounted; `EXEC` stays off; no `git` in the panel image | **Stands** |
| ADR 0010 | `gh` is optional on top of local `git` for open pull requests | **Stands as the fallback** when no App is configured. The App becomes the source for issue and pull-request *state* once it is |
| ADR 0010 | "Read-only, in both directions… no webhook; no write to any repository" | **Superseded for GitHub issues, sub-issues, issue types/fields and pull-request state.** Local working trees remain read-only |
| ADR 0010 | "The gateway observes environments, it does not drive them" | **Stands for Git working trees and Docker.** It does not stand for GitHub issues |
| ADR 0008 | The panel's socket proxy and allowlist | **Stands.** GitHub is HTTP egress, not a Docker capability |
| ADR 0012 | The panel is loopback by default; public exposure is refused | **Stands.** Webhooks never require public exposure |
| ADR 0013 | Persist a decision, never an observation | **Amended:** a projection of a remote source of truth is a third category, below |
| ADR 0001 | The gateway does not mount consumer project directories | **Stands** |

ADR 0010 is marked amended, not replaced. Everything it decided about
*local* Git still holds.

## Decision

> **Local Git stays on the host. Issues move to a GitHub App in the
> panel.** `portta git scan` keeps producing branch, HEAD, dirty
> counts and ahead/behind from local `git` — no network, every forge,
> works offline. The App takes over issues, sub-issues, issue types,
> issue fields and pull-request state, because those are not derivable
> from a working directory and because writing them is the point.

The host-side `gh pr list` path remains the documented fallback for a
panel with no App configured, exactly as ADR 0010 described it.

### 1. Egress is opt-in in code, on a network the panel already has

`docker/compose/features/web.yaml` already attaches the panel to the shared `gateway`
network, which is **not** `internal`. Docker therefore already gives the
container a default route. Today's "no egress" is a property of the
process: the only outbound `fetch` is to Traefik. It is not a property of
the network.

Enabling the App uses that existing route. No new network. Do not make
`gateway` internal; that would break Traefik routing to the panel.

**The gate is in code:** if the App is not configured, the panel does not
call `api.github.com`. Configuration is what turns the existing route
into GitHub egress, not a Compose overlay.

Cost: a container that may be routed over a VPN talks to the internet
once the integration is on. On the public profile the panel remains
inbound-refused ([ADR 0012](0012-panel-authentication-is-traefiks.md));
outbound to `api.github.com` from a VPS is the same class of call as
from a laptop. `doctor` should report whether GitHub egress is
configured, not whether a socket can connect.

### 2. Reconciliation is the baseline; webhooks are an optimisation

A loopback panel cannot receive a GitHub delivery. Correctness must not
depend on one.

A reconciliation loop, using `updated_at` cursors rather than full
sweeps, is the source of freshness. Webhooks become a supported add-on
only when all of these are true:

- the panel is already published on a path GitHub can reach (the VPN
  overlay, not loopback);
- the operator has configured a webhook secret;
- every delivery is signature-validated before it is parsed.

Public exposure of the panel stays refused. A webhook never becomes a
reason to bind `0.0.0.0` or to attach the panel to the public
entrypoints.

Default: no webhooks. A loopback panel is correct, just slower to notice
a change made on github.com.

Cost: the default posture stays honest, and a laptop without a
published URL still works. The cost of the add-on is an inbound URL on
a deployment the user already opted into, plus a webhook secret.

Two panels holding the same App installation would both reconcile the
same repositories. That is a concurrency problem for issue #20, not a
sharing feature; [ADR 0016](0016-state-that-could-be-shared.md) already
says GitHub projections are not copied between instances.

### 3. The private key is not a `.env` value the panel can write

| Secret | Where it lives | What the API may return |
|---|---|---|
| App id | `.env` (`PORTTA_RUNTIME_GITHUB_APP_ID`), not marked secret | the id |
| Private key | a host file, mode `600`, mounted read-only; only its path is in `.env` | whether the path is set, never the PEM |
| Webhook secret | the same shape as the private key: a file, path in `.env` | whether it is set |
| Installation tokens | process memory, with their expiry | nothing. Never persisted, never logged, never sent to the browser |

`PATCH /api/config` must not be able to write a PEM or a webhook secret
into `.env`. The existing `secret: true` fields (`TS_AUTHKEY`,
`CF_DNS_API_TOKEN`, `PORTTA_WEB_AUTH_HASH`, `PORTTA_RUNTIME_DB_PASSWORD`)
are write-only strings in `.env`; that pattern is **not** sufficient for
a GitHub App private key. The shape is the one `state/git` already uses:
the panel reads a file it cannot usefully overwrite through Settings.

Installation tokens are minted from the private key, live about an hour,
and are discarded at expiry or process restart. Do not store them in
PostgreSQL. Do not assume they are 40 characters long.

Logs may contain App id, installation id, repository nwo and HTTP status.
They may not contain PEMs, tokens, webhook secrets or raw delivery
payloads that include them.

### 4. A projection is a third category

[ADR 0013](0013-what-the-panel-persists.md) said persist a decision,
never an observation. A projection of GitHub issues is neither. The
amended rule is:

> Persist a decision, never an observation. The panel may also cache
> what a remote source of truth owns, provided every projected row
> records where it came from and when, the UI shows that age, and
> nothing cached is ever the only copy.

The comment in `apps/web/migrations/0001_initial.sql` is updated to match.
The schema for the cache belongs to issues #18 and #20, not to this
record.

### 5. Source of truth

| Fact | Owner |
|---|---|
| Issue title, body, state, labels, assignees, milestone, type, field values, sub-issue links, pull-request state | GitHub |
| Branch, HEAD, dirty counts, ahead/behind | Local `git`, collected on the host (ADR 0010) |
| Containers, health, URLs, networks | Docker / Traefik on this host |
| Which GitHub repositories a Portta project owns | Portta (a decision) |
| Which environments a Portta project has adopted | Portta (a decision) |
| A link from an issue to an environment | Portta (a decision) |
| Theme, aliases, display names | Portta (a decision) |

The panel never edits GitHub by writing only to PostgreSQL. A board
column that means "closed" closes the issue on GitHub, then the
projection follows. A local ranking or pin is a gateway decision and is
labelled as one.

Documented for readers who will not open an ADR: [docs/github.md](../github.md).

### 6. Project, environment, repository

Names, not columns. The migration is issue #19.

| Entity | What it is | Today |
|---|---|---|
| **Environment** | One Compose project on this host. Local identity is `COMPOSE_PROJECT_NAME` ([ADR 0006](0006-compose-project-name-as-namespace.md)). Portable coordinates are `repo_url` / `repo_subpath` / `slug` ([ADR 0016](0016-state-that-could-be-shared.md)) | The `projects` table |
| **Project** | A grouping the user creates. It owns repositories and adopts environments | Does not exist |
| **Repository** | A GitHub repository bound to a project | A nullable coordinate on the environment row |

Today's `projects` row is an environment. Issue #19 renames in the
schema; this record forbids treating `compose_project` as the Dev
Gateway project.

The label `portta.project` remains a **discovery hint** for grouping
worktrees under one heading, as ADR 0010 defined it. It does not create
the new project entity, and the panel must not infer one from it
automatically. A person creates a project and may adopt environments
whose label matches. Two grouping mechanisms that silently disagree
would be worse than one explicit grouping.

A project owning N repositories, and later a group owning N projects,
fits this model. Agent runs and parallel worktrees attach to
*environments*, which already exist per worktree. That is enough to
avoid foreclosing them.

### 7. Degradation

| Condition | Panel behaviour |
|---|---|
| No App configured | Docker-backed pages unchanged. Git cards stay on the host snapshot. Issue surfaces are absent, not broken |
| GitHub unreachable, 5xx, timeout | Serve the projection, show its age, do not fail the rest of the panel |
| Rate limit exhausted | Same as unreachable. The remaining budget is visible on a diagnostic surface. Reconciliation backs off |
| Invalid private key / installation | Configuration error on the GitHub surface; everything else stays up |
| Read-only mode | GitHub writes are refused the same way local writes are. The UI does not offer them |

PostgreSQL remaining a soft dependency ([ADR 0013](0013-what-the-panel-persists.md))
is unchanged. A GitHub surface that needs the projection returns a clear
503 if the database is down; Overview does not.

Rate limits: every client keeps and exposes the remaining budget from
GitHub's response headers. Reconciliation uses cursors. Exhaustion
degrades to the projection rather than to an error page.

### 8. Read-only mode covers writes that leave the host

`PORTTA_WEB_READ_ONLY` already refuses unsafe HTTP methods in
`apps/web/src/server/app.ts`. That refusal includes a write that would land
on github.com. A read-only panel may refresh a projection. It may not
create, edit, close, comment, reparent or relabel an issue, and it may
not approve or merge a pull request.

### 9. Dependency budget

Measured 2026-09-01 with Node 22 and npm, `npm install --package-lock-only
--omit=dev`, counting resolved packages excluding the measuring root.
The panel's current production tree is **12**
([ADR 0017](0017-no-docker-sdk.md)).

| Package | Resolved packages | Verdict |
|---|---:|---|
| `octokit` (meta) | 63 | **Forbidden.** It more than quintuples the tree |
| `@octokit/app` | 44 | Rejected as the default. Almost four times the panel |
| `@octokit/auth-app` | 28 | Rejected as the default, same reason |
| `@octokit/rest` | 20 | Rejected as the default |
| `@octokit/request` | 8 | Acceptable only if a purpose-built client proves worse |
| `@octokit/webhooks` | 6 | **Allowed when webhooks ship.** Signature verification is easy to get wrong |

**Default: a purpose-built GitHub App client using `fetch`**, the same
shape as the Docker client. JWT minting (RS256) and
`POST /app/installations/{id}/access_tokens` are small, well-specified
tasks. REST calls are `fetch` with `X-GitHub-Api-Version` set. Resulting
runtime until webhooks: **12**. With `@octokit/webhooks`: **18**.

The GitHub integration must not more than double the production tree.
The meta-package is never added to close a gap that `fetch` can close.

Issue #18 names the exact packages it adds and updates this budget if
the count moves.

## Consequences

- Issues #18–#22 can each be reviewed as ordinary work: the App and the
  repository projection, projects that own repositories, the issue
  projection and sync, the board, the issue↔environment links.
- Local Git does not become worse. A host without a GitHub App still has
  branch, dirty state and `gh`-sourced pull requests.
- The panel gains a new class of secret and, when configured, a new
  class of egress. Both are explicit, both are off by default, both are
  visible to `doctor`.
- An Accepted ADR was superseded in named sentences. The next reversal
  of 0010 is cheaper because the remaining sentences are still true.
- Agents, worktrees and a future task runner are not designed here.
  They attach to environments.
