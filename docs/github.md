# GitHub

The panel does not talk to GitHub yet. The architecture is decided in
[ADR 0018](adr/0018-github-access-lives-in-the-panel.md); implementation is
issues #18–#22. This page exists so the source-of-truth split is findable
without opening an ADR.

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
