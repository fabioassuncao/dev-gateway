# 0016. State that could be shared, and what must never be

**Status:** Accepted

This record classifies state and decides identity. **No synchronisation is
being implemented.** Two gateways still know nothing about each other. The
cost of keeping that possible later was paid by issue #4: three nullable
columns, one instance row, and `updated_at` on every decision table. This
page says what those seams are for, and what they are not for.

## Context

Two Porttas, one person: a laptop and a development VPS, with the same
repositories checked out on both. Name a project *Storefront* on the laptop,
give it a short hostname, and none of that exists on the VPS — where an agent
may be doing the actual work.

The appealing version of this is "sync the gateways". The correct version is
narrower: **most of what a gateway knows is true only of the machine it runs
on**, and trying to share it would be actively wrong. A container id, a
loopback port, an absolute path and a Docker network are facts about one host.

Issue #4 already shipped PostgreSQL. The schema includes `instance.id` (a
UUID), `projects.repo_url`, `projects.repo_subpath`, `projects.slug`, and
`updated_at` on every decision table. This investigation validates those
seams rather than requesting a future migration. [ADR 0014](0014-monorepo-and-the-typescript-cli.md)
places persistent decisions behind the panel API; this record says which of
those decisions could ever travel.

This is not a multi-host dashboard. Sharing an administrative decision is not
the same feature as showing another machine's containers.

## Decision

> **Share what a person decided about a project. Never share what a machine
> observed.**

### Five kinds of state

Every fact the gateway holds on 2026-09-01, including what issues #1, #4 and
#6 added.

| Kind | Examples | Source today | Shareable |
|---|---|---|---|
| **Runtime** | container ids, state, health, uptime, published ports, networks, mounts, working_dir, access-bridge ports, Traefik routers and their live status, Docker logs and stats | Docker Engine, Traefik API, kernel-allocated ports | **Never.** Re-derived in milliseconds and wrong anywhere else |
| **Instance** | bind address, domains, TLS mode, profile, ACME, `TS_AUTHKEY`, `CF_DNS_API_TOKEN`, panel auth hash, `COMPOSE_PROJECT_NAME` of the gateway itself, database password | `.env` | **Never.** Host-specific, and half of it is secret |
| **Project** | display name, description, primary service, hidden services, ordering, notes, `repo_url` / `repo_subpath` / `slug` | PostgreSQL (`projects`, `project_settings`, `service_settings`) | **Yes**, with the identity rules below |
| **User** | theme, default page, table density | PostgreSQL (`settings`) | **Yes**, and low stakes either way |
| **Shareable, with translation** | hostname alias | PostgreSQL `service_settings.alias` plus a generated Traefik file | **Partly** — see aliases |

Git snapshots under `state/git/` and host snapshots under `state/host/` are
runtime observations collected on the host
([ADR 0010](0010-git-collected-on-the-host.md)). They are not shareable as a
source of truth; `repo_url` extracted from a Git file is a portable
*coordinate*, which is a different column doing a different job.

Share records (temporary extra hostnames with expiry) are instance-scoped:
they bind a live container name to a host-specific domain. They are not
project decisions.

A future GitHub issue projection ([ADR 0018](0018-github-access-lives-in-the-panel.md))
is a cache of a remote source of truth, not a decision and not a Docker
observation. It is not shared between instances by copying rows; each
instance talks to GitHub itself. Two panels holding the same App
installation is a concurrency problem for issue #20, not a sync feature.

`COMPOSE_PROJECT_NAME` of a *consumer* environment is local identity, not
shareable on its own: `storefront` on the laptop and `storefront` on the VPS
are probably the same project, and `storefront-issue59` is a worktree that
may not exist remotely at all.

### Project identity

Not a distributed identity system. A **local id plus portable coordinates**:

```text
projects
  id               BIGSERIAL      local, never shared, never meaningful elsewhere
  compose_project  TEXT UNIQUE    the namespace, per ADR 0006 — local identity
  working_dir      TEXT NULL      local only
  repo_url         TEXT NULL      normalised remote: github.com/owner/repo
  repo_subpath     TEXT NULL      for a monorepo package
  slug             TEXT NULL      a stable, user-visible name, unique per instance
```

Issue #4 delivered this shape. `(repo_url, repo_subpath)` is the portable
coordinate. `slug` is the fallback for a project with no Git, and the manual
association two people (or two gateways) can agree on.

The worktree case: `storefront` and `storefront-issue59` share a `repo_url`
and differ in `compose_project`. Sharing, if it is ever built, operates on
the repository coordinate. Per-environment overrides stay local, which is
what issue #5 already decided for the right reasons.
[ADR 0013](0013-what-the-panel-persists.md) already forbids two worktrees
from inheriting each other's aliases.

Nothing merges. `repo_url` is a coordinate, not a key.
`compose_project` stays the local identity.

### `repo_url` normalisation

A pure function. Inputs that denote the same repository must compare equal.
Covered forms, with examples:

| Input | Normalised |
|---|---|
| `git@github.com:acme/storefront.git` | `github.com/acme/storefront` |
| `https://github.com/acme/storefront` | `github.com/acme/storefront` |
| `https://github.com/acme/storefront.git` | `github.com/acme/storefront` |
| `ssh://git@github.com/acme/storefront.git` | `github.com/acme/storefront` |
| `git@gitlab.com:acme/storefront.git` | `gitlab.com/acme/storefront` |
| `https://git.example.com/acme/storefront.git` | `git.example.com/acme/storefront` |
| empty / no remote | `null` |

Rules:

1. Strip the scheme (`git+ssh://`, `ssh://`, `https://`, `http://`).
2. Strip a leading `git@` user and rewrite `host:path` to `host/path`.
3. Strip a trailing `.git`.
4. Strip a trailing slash.
5. Lowercase the host. Do **not** lowercase the path: some forges are
   case-sensitive, GitHub is not, and over-normalising merges distinct
   repositories on a self-hosted forge.
6. Drop a trailing `.wiki.git` or `/issues` suffix; those are not the
   repository.
7. Submodules are separate repositories with their own remotes; a consumer
   project's `repo_url` is the superproject, and `repo_subpath` names a
   package inside it, not a submodule.
8. No remote, or a remote that is a local path, yields `null`. `slug` then
   carries identity if a person supplies one.

The function belongs in `packages/core` once the CLI and the panel both
need it. Until then it may live next to the Git collector. It is tested
with a fixture table covering every row above.

### Instance identity

Issue #4 created a singleton `instance` row: a generated UUID that never
changes, a human-chosen `name` (default `portta`), `created_at` and
`updated_at`.

That is enough. `portta status --json` (issue #9) should include
`instance.id` and `instance.name` so two gateways can be told apart the day
there are two. The UUID is local. It is not a tracking identifier, and
nothing transmits it anywhere today.

`updated_by_instance` on eligible rows is **not** added now. It is a sync
column, and this record forbids shipping sync machinery.

### Aliases are labels, not hostnames

`shop.localhost` on a laptop; `*.dev.example.com` on a VPS. A shared alias
cannot be a hostname.

The stored value is a **DNS label**: `shop`. Each instance renders it against
its own `PORTTA_DOMAIN`, `PRIVATE_DOMAIN` or `PUBLIC_DOMAIN`. The
laptop serves `shop.localhost`, the VPS serves `shop.dev.example.com`, and
nothing shared contains a hostname.

Issue #5's catalogue already matches this: `SERVICE_KEYS.alias` is a
lowercase DNS label (letters, digits, hyphens, at most 63 characters), not a
FQDN. Keep it that way. Rendering the hostname is instance-local and happens
when the Traefik file is written, not when the preference is stored.

### The four architectures, if synchronisation is ever built

| | Central service | Central PostgreSQL | Peer-to-peer | Hybrid |
|---|---|---|---|---|
| **Shape** | Both instances call one control plane | Both connect to one database | Each keeps its own, exchanges changes | Local database, selected records via a shared layer |
| **Complexity** | High — a service to build, host, secure, upgrade | Low to build | Very high — conflict resolution, vector clocks or CRDTs | Medium |
| **Offline** | Degraded or broken | **Broken** — the laptop stops working on a plane | Full | Full |
| **Security** | An authenticated API, tokens, rotation | A database open to the internet, or a tunnel | Mutual auth between instances | One narrow authenticated surface |
| **Conflicts** | Server decides | Not applicable | The hard part | Last-write-wins on a small record set |
| **Operational cost** | A service to run forever | A database to run forever | None beyond the instances | Small |
| **Verdict** | Overkill for one person | **Disqualified by offline** | Disproportionate | **Recommended, if ever** |

Two of the four are eliminated on requirements rather than taste:

- **Central PostgreSQL fails the basic requirement.** The gateway's whole
  purpose is a local development environment; one that stops working without
  a network connection is a worse tool than one that never synced.
- **Peer-to-peer is a distributed-systems project.** Conflict resolution over
  an arbitrary record set is not a side feature of a development gateway.

**If synchronisation is ever built, it should be hybrid and boring:**

- each instance keeps its own PostgreSQL and works fully offline;
- only `project` and `user` state is eligible, and only for projects with a
  `repo_url` or an explicit `slug`;
- every eligible row already carries `updated_at`; a future sync change may
  add `updated_by_instance`;
- reconciliation is **last-write-wins per field**, with both values shown in
  the panel when they differ — a person resolving a name clash is cheaper
  than a merge algorithm;
- the transport is a push/pull command, not a daemon:
  `portta sync push` / `pull`, over the panel's existing authenticated
  API ([ADR 0012](0012-panel-authentication-is-traefiks.md)) reached over the
  tailnet;
- an append-only event log is **not** needed for last-write-wins on a few
  dozen rows.

Last-write-wins loses data by design. Acceptable for a friendly name. It
must stay written down rather than discovered in a support thread.

### The cheapest first experiment

Sync by committing state to a Git repository — a `~/.portta` repo
pushed and pulled — is not the plan. It is the cheapest prototype if this
is ever tried: conflict resolution, history and transport all come free, and
the audience already uses Git constantly. It turns every preference change
into a commit and needs a repository provisioned per user, which is why it
is recorded rather than chosen.

### Asks already delivered, and asks that remain

| Issue | Ask | Status on 2026-09-01 |
|---|---|---|
| #3 | Classify state five ways, not two; record the identity model | This ADR |
| #4 | `repo_url`, `repo_subpath`, `slug` nullable on `projects`; an `instance` table with a UUID; `updated_at` on project- and user-scoped rows | **Delivered.** Validated against `apps/web/migrations/0001_initial.sql` |
| #5 | Store the alias as a label, render the hostname per instance | Catalogue already stores a label (`SERVICE_KEYS.alias`). Rendering remains instance-local when the Traefik file is written |
| #9 | `--json` output identifies the instance; the CLI never opens its own database connection | Still open. ADR 0014 already forbids the database connection |

## Consequences

- Two gateways still know nothing about each other.
- Anyone proposing synchronisation later starts from a page that already
  says what may be shared, what identifies a project across machines, why a
  central database was ruled out, and why last-write-wins is enough.
- If it is never built, the cost was three nullable columns and one table
  that made `portta status --json` able to say which gateway answered.
- Runtime state must not leak into "shareable". A review check on every new
  column: is this a decision a person made, or an observation a machine
  made?
- Issue #20 (a reconciliation loop plus a webhook receiver) makes this
  sharper: two panels holding the same GitHub App installation would both
  reconcile the same repositories. That issue does not solve sharing; it
  requires `github_sync_state` writes to be safe under concurrency.

## What this record forbids

No synchronisation code, no sync table, no `updated_by_instance` column, and
no network call ships from the change that accepts this ADR.
