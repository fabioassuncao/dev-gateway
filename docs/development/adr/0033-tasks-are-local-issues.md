# 0033. Tasks are local issues with sparse board ranks and API credentials

**Status:** Accepted, amends [0032](0032-portta-development-model.md)

## Context

The local Task model existed, but its board did not persist card order, writes
could replace an entire row after reading it, comments meant two different
things, and the remote CLI still depended on the panel's shared Basic
credential. These gaps made the UI, CLI and GitHub binding behave like
different products.

## Decision

- A Task is the canonical issue. GitHub remains an optional binding.
- A local write commits before any GitHub request. Failure sets the binding to
  `pending` or `error`; it never rolls the Task back.
- Linking an existing issue requires an explicit initial direction: `pull`
  imports the issue fields, while `push` publishes the Task fields.
- The shared fields are title, description, status, priority, labels and
  assignee. Type, agent, due date, parent, repository/environment/service,
  board rank and local comments remain local.
- Comments are local by default. Publishing one creates an explicit copy on
  GitHub and records that copy's id, URL and retry state.
- Board order is a `BIGINT` sparse rank. Ranks are 1024 apart; a move writes
  one row and only rebalances the destination column when no integer gap is
  left. An advisory transaction lock serializes ranking within a column.
- Common changes use partial `PATCH`; card movement uses the dedicated move
  endpoint with its adjacent task ids.
- Remote clients authenticate with revocable Bearer tokens. A token has an
  actor and capability set, no implicit expiry, is shown once, and only its
  SHA-256 digest is persisted. Existing Basic and browser session auth remain.

## Consequences

The browser, CLI, MCP and direct API calls exercise the same validation,
activity and GitHub synchronization path. A GitHub outage degrades only the
binding. Tokens can be revoked without rotating the panel password. Sparse
ranks avoid rewriting a column on ordinary moves, while the rare rebalance is
bounded to one project/status column.
