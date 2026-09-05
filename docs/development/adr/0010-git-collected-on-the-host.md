# 0010. Git is collected on the host, and the panel only reads the result

**Status:** Accepted, amended by [ADR 0018](0018-github-access-lives-in-the-panel.md)

ADR 0018 supersedes the sentences that forbade GitHub API access, webhooks
and writes to issues from the panel. Local `git` collection, the
`state/git/` snapshot, the refusal to mount project directories, and
read-only working trees are unchanged. The sentence-by-sentence split is
in ADR 0018.

## Context

Opening `base-empresarial-issue59` in the panel says it is a second worktree of
`base-empresarial` and nothing else. Which branch it is on, whether there is
uncommitted work, and which pull request it belongs to are all questions people
answer by leaving the panel for a terminal.

The panel cannot answer them today, and the reason is structural rather than
missing code. Its container gets exactly two host paths (`.env` and `VERSION`),
ships no `git`, no `gh` and no Docker CLI, runs no shell commands, and reaches
Docker through a proxy with `EXEC: "0"` and an allowlist that denies `exec`,
`archive` and `prune` in the panel's own process
([ADR 0008](0008-web-panel-socket-proxy.md)). The one container it may create
has a fixed shape with no binds at all.

What it does already hold is the host path of every project: Compose writes
`com.docker.compose.project.working_dir` on every container, and
`apps/web/src/server/core/inventory.ts` already reads it. The panel knows exactly
where each repository is. It just cannot look.

Every way of letting it look costs a guarantee:

**Mounting the project directories** is the obvious one and the worst. It
contradicts [ADR 0001](0001-decoupled-infrastructure.md) in as many words, and
it hands a container that may be routed over a VPN read access to every
project's source, `.env` files and credentials. On a VPS that is the machine.

**Enabling `EXEC` and running `git` inside a project container** is arbitrary
command execution in someone else's container, from a component reachable over
a network, and it usually does not even work: most project images carry no
`git`, and the repository is frequently not mounted into them.

**Generalising container creation** to spawn a short-lived `git` container with
a bind mount is the one that sounds reasonable. `createBridge` forbids binds by
construction; loosening it turns "one fixed shape" into "any host path into a
container", which is the single thing ADR 0008 exists to prevent.

**Calling the GitHub API from the panel with a token in `.env`** avoids the
filesystem entirely, and buys a long-lived credential in a file the panel
itself can write, egress from a container that has none today, and our own
rate-limit accounting.

## Decision

Invert it. The component that already runs on the host, already has `git`, and
already knows every project's directory is the CLI.

`portta git scan` reads the Compose labels, walks to each project's
working directory, runs read-only `git` there, and writes one file per project
under `state/git/`, mode `600`. `docker/compose/features/web.yaml` mounts that directory into
the panel read-only, and `GET /api/projects/:project/git` reads the file.

```
portta git scan          host: labels -> working_dir -> git -> gh
        |
   state/git/<project>.json   one file per Compose project, mode 600
        |
   ./state/git:/app/state/git:ro
        |
   GET /api/projects/:project/git
```

Four things follow from that, and each is a decision of its own.

**Local `git` is the primary source, and `gh` is optional on top.** Branch,
HEAD, dirty counts, ahead/behind and the remote URL come from `git status
--porcelain=v2 --branch` and one `rev-list`, which need no network and no
authentication and work for every forge and for no forge at all. Repository,
commit and branch web URLs are derived from the remote URL by string work, so
GitHub, GitLab, Bitbucket and self-hosted remotes all get links. Open pull
requests come from `gh pr list --json` under an explicit `--with-prs`, reusing
the developer's existing authentication: no token in `.env`, nothing to leak
from a panel that may be routed, no rate limit of ours to account for. No `gh`,
no `forge` block, no GitHub section in the UI.

**The data is a snapshot, and the panel says so.** Nothing polls. The scan runs
from `portta up`, from `portta web up`, by hand, or from a cron the
user writes. Every file carries `collectedAt`; the panel renders the age,
marks anything past a threshold as stale, and prints the exact host command to
refresh it. That is the same honesty `doctor` and the pending-settings banner
already apply.

**Metadata only.** Branch names, commit subjects, counts and URLs. Never a
diff, never a file's contents, never a credential, and never a commit list
beyond HEAD: a link to the repository beats a worse commit browser.

**Read-only, in both directions.** No checkout, merge, rebase, reset, stash,
fetch or push; no PR approval or merge; no webhook; no write to any repository.
The gateway observes environments, it does not drive them.

Alongside it, three **optional** labels let a project declare what cannot be
derived, extending `LABELS` in `apps/web/src/server/core/labels.ts`:

| Label | What it settles |
|---|---|
| `portta.project` | The logical project, when `COMPOSE_PROJECT_NAME` is a per-worktree namespace, so several worktrees group under one heading |
| `portta.repo` | `owner/name` or a remote URL, which gives forge links with no host-side Git at all |
| `portta.git.root` | The repository root, when the Compose file is not at it (see [monorepos.md](../../product/guides/monorepos.md)) |

Every one of them is optional. The existing inference (`workingDir`, and a
`namespace` derived when the directory basename disagrees with the project
name) stays as the fallback, and a project that sets none behaves exactly as it
does today. That is asserted in the test suite, not just promised here.

## Consequences

The panel gains Git without gaining a single new capability: no project
directory is mounted into it, `EXEC` stays off, container creation keeps its
one shape, and the new mount is read-only and contains nothing but metadata the
scan chose to write.

The cost is freshness. What the panel shows is as true as the last scan, and it
will sometimes be wrong. The mitigation is to never imply otherwise: the age is
on screen, staleness is marked, and the refresh command is one copy away.

`state/git/` is a new host path with a new failure mode: it is written by the
CLI as the invoking user and read by a container that may run as `node`.
`PORTTA_WEB_USER` already exists for the same reason on `.env`, and the
scan makes the directory `700` and each file `600`.

There is a second reason the ordering matters. Branch names, commit subjects
and PR titles are more sensitive than container names, and this makes the panel
an inventory of what is being worked on as well as what is running. That is
why [ADR 0012](0012-panel-authentication-is-traefiks.md) comes first in the
execution plan and not last.

A project that uses no Git degrades to no Git card. A repository with no
remote loses the links and keeps the branch. A detached HEAD says so. A
non-GitHub remote keeps its derived links and has no pull requests. None of
those is an error, and the tests enumerate them.
