# GitHub

The panel can authenticate to GitHub as an App, list the installations and
repositories it was granted, and hold them in its own projection. Issues, a
board and the link between an issue and an environment are the phases after
this one. The architecture is decided in
[ADR 0018](adr/0018-github-access-lives-in-the-panel.md).

**It is off by default.** With `GITHUB_APP_ENABLED=false` the panel makes no
request to github.com and behaves exactly as it did before this existed.

## What stays on the host

`dev-gateway git scan` still collects branch, HEAD, dirty counts and
ahead/behind from local `git`, and writes `state/git/<project>.json`.
The panel only reads that snapshot. No project directory is mounted into
the panel. See [ADR 0010](adr/0010-git-collected-on-the-host.md).

## What will live in the panel

A GitHub App, once configured, reads and writes issues, sub-issues, issue
types, issue fields and pull-request state. Local working trees stay
read-only. A Personal Access Token in `.env` is not the design.

## Source of truth

| Fact | Owner |
|---|---|
| Issue title, body, state, labels, assignees, milestone, type, field values, sub-issue links, pull-request state | GitHub |
| Branch, HEAD, dirty counts, ahead/behind | Local `git` on the host |
| Containers, health, URLs, networks | Docker / Traefik on this host |
| Which GitHub repositories a Dev Gateway project owns | Dev Gateway |
| Which environments a Dev Gateway project has adopted | Dev Gateway |
| A link from an issue to an environment | Dev Gateway |

The panel never treats PostgreSQL as a second GitHub. A board action that
means "close" closes the issue on GitHub; the local row is a cache with
an age, not the original.

## Project, environment, repository

A **project** is a grouping a person creates. An **environment** is one
Compose project on this host (`COMPOSE_PROJECT_NAME`). A **repository**
is a GitHub repository bound to a project. Today's `projects` table is
the environment; renaming it is part of building the new project entity.

The Compose label `dev-gateway.project` remains a hint for grouping
worktrees. It does not silently create a Dev Gateway project.

## Default posture

- No App configured: the panel behaves as it does today.
- App configured: outbound calls to `api.github.com` on the network the
  panel already has. No new Docker network.
- Webhooks off by default. A loopback panel cannot receive them.
  Correctness comes from reconciliation. Webhooks are an optimisation
  for a panel the operator has already published.
- The panel stays refused on the public profile.
- Read-only mode refuses GitHub writes too.

## Setting it up

### 1. Create the App

GitHub → *Settings* → *Developer settings* → *GitHub Apps* → *New GitHub App*.

- **Homepage URL** can be anything; the panel never serves one.
- **Webhook**: leave it off for now. A loopback panel cannot receive
  deliveries, and correctness comes from reconciliation rather than from a
  webhook that may never arrive. Generate a secret if you enable it later.
- **Where can this App be installed**: *Only on this account* is the right
  answer for a development host.

### 2. Ask for these permissions, and no others

| Permission | Access | Why |
|---|---|---|
| Metadata | Read | Mandatory; it is what lists repositories |
| Issues | Read and write | The board writes back to GitHub |
| Pull requests | Read | Open pull requests on a project page |
| Contents | Read | Default branch and repository shape |
| Commit statuses | Read | Whether checks passed |
| Checks | Read | The same, for the Checks API |

**Never `Contents: write`.** The gateway does not commit, push, merge or
rebase, and an App that cannot write code cannot be talked into it.

### 3. Install it, and give the panel the key

Install the App on the account, choosing the repositories it may see. That
choice is the authorisation boundary: the panel refuses any operation on a
repository the installation did not grant, before it makes a request.

Then download the private key and put it where the panel mounts it read-only:

```bash
mkdir -p state/github
mv ~/Downloads/your-app.*.private-key.pem state/github/app.pem
chmod 600 state/github/app.pem
```

The key is a **file**, never a value in `.env`. The panel can write `.env`
from its Settings page, and it must not be able to write the key that
authenticates it.

### 4. Turn it on

```bash
# .env
GITHUB_APP_ENABLED=true
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY_FILE=/app/state/github/app.pem
GITHUB_API_URL=https://api.github.com     # or your Enterprise Server API root

dev-gateway web restart
dev-gateway doctor            # checks the id, the key, its mode and the API URL
```

Then open **Settings → GitHub** in the panel and press **Sync**.

## What is stored, and what is not

Stored, in the panel's own PostgreSQL:

- `github_installations` — which installations exist, for which account, with
  which permissions, and when they were last seen.
- `github_repositories` — the repositories those installations granted. This
  table is the authorisation boundary.
- `github_sync_state` — one row per sync scope, with its last run and its last
  error, so a failure is visible rather than silent.

Every row carries `synced_at`, so the UI can always say how old an answer is —
the same discipline `GitCard` already applies to a host Git scan.

**Never stored:** the private key, the webhook secret, and any installation
token. A token lives for an hour, is minted on demand, cached in memory with
its expiry and refreshed early. No code path writes one to a row, a log line or
an API response, and a test asserts that.

## No Octokit

The panel image resolves three runtime dependencies, and that smallness is part
of what makes it safe to run on a host that may be reachable over a VPN. What
this needs is an RS256 JWT, a token exchange, Link-header pagination and
rate-limit accounting — about two hundred lines on `node:crypto` and `fetch`.

**Added runtime dependencies: zero.** It is the same trade
[ADR 0011](adr/0011-panel-reads-traefik-writes-one-file.md) made for apr1, and
it is revisited if the surface grows past what is honest to maintain.

## When GitHub is down

The GitHub endpoints answer `503` with a hint, exactly as the database's do.
The projected repository list still answers, because it is read from
PostgreSQL. Every Docker-backed page is unaffected: the panel never blocks a
snapshot on a network call it does not control.

Rate-limit exhaustion is a typed error rather than a 500, and the remaining
budget is on **Settings → GitHub** and in `GET /api/status` so it is visible
before it runs out.

## The API

| Endpoint | What it does |
|---|---|
| `GET /api/integrations/github` | Configuration, reachability, installations, repository count, rate-limit budget, last sync. Never a secret |
| `GET /api/integrations/github/repositories` | The projection, served from the database so it answers while GitHub is down |
| `POST /api/integrations/github/sync` | Idempotent re-sync. Refused in read-only mode |

`GET /api/status` carries the same `github` block, so one request tells an
agent whether the integration is usable.
