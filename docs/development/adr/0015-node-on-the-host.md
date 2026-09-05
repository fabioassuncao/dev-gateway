# 0015. Node is not required for the core commands

**Status:** Accepted

## Context

The project currently advertises:

> The host needs Docker, Git and a shell, the same as the gateway itself.
> **Node is not required on the host**: the image builds the UI and the server.
> — `docs/web-ui.md`

`README.md` says the same under Requirements: Docker Engine 24+, Git, and a
POSIX shell. Node is listed only as a requirement for *developing* Portta.

`npx portta` requires Node on the host. That is not a
detail to discover halfway through the TypeScript CLI migration
([issue #9](https://github.com/fabioassuncao/portta/issues/9)).
[ADR 0014](0014-monorepo-and-the-typescript-cli.md) decides the layout; this
record decides the host requirement.

Three options were on the table:

**(a) Node becomes a requirement.** Simplest architecture. It breaks a
documented promise and, on a fresh VPS, starts provisioning with "install
Node", which is precisely what `npx setup` was meant to avoid.

**(b) Two CLIs.** The Bash `bin/portta` stays as the zero-dependency
path; the TypeScript CLI is an additional, optional interface. Keeps the
promise, and guarantees the duplication ADR 0014 exists to remove.

**(c) One CLI, two entry points.** `bin/portta` stays and becomes thin:
it detects Node and delegates to the TypeScript CLI when present, and
otherwise runs the Bash implementation for the small set of commands that
must work without Node.

## Decision

Option (c). One CLI, two entry points.

`bin/portta` remains the documented binary. When Node 22+ is on `PATH`
and `packages/cli` (or the published package) can be loaded, it delegates.
When Node is absent, it runs the Bash implementation for the commands below
and refuses the rest with a message that names the requirement.

### Commands that must work without Node

These are the commands a bare host needs before anything else is installed:

| Command | Why it cannot wait for Node |
|---|---|
| `bootstrap` | Prepares the host; this is how a VPS gets from clone to running |
| `up` | Starts the gateway from Compose |
| `down` | Stops the gateway |
| `status` | Answers whether it is up |
| `doctor` | Diagnoses a host that may have nothing else installed |

`web up` and `web down` continue to work without Node **for as long as they
remain Compose-driven Bash**. The panel image is built inside Docker; the host
does not need Node to run it. Once those commands are ported, they join the
Node-required set unless a Bash fallback is kept in the same change. Do not
silently drop the zero-Node panel lifecycle.

Everything richer (`project`, `git`, `config`, `task`, `--json` output beyond
what Bash already prints) requires Node 22.12+ and says so.

### Provisioning

- A host that already has Node: `npx portta setup`.
- A bare VPS: `git clone && ./bin/portta bootstrap`, which works today
  and keeps working.

### README wording, when the TypeScript CLI ships

Issue #11 forbids advertising a planned feature in `README.md`. The wording
change below is applied by issue #9, not by this record.

**From:** "The host does not need Node to run the gateway or panel."

**To:** "Node is not required for the core commands (`bootstrap`, `up`, `down`,
`status`, `doctor`); the full CLI needs Node 22.12+."

`docs/web-ui.md` loses the absolute "Node is not required on the host" once
the TypeScript `web` commands exist. Until then the sentence remains true:
the image still builds the UI and the server.

### Testing the entry point

The delegating dispatcher needs its own tests in `tests/unit/`, including a
run with Node removed from `PATH`. A load-time defect in the TypeScript CLI
(an option registered twice, a bad import) throws before any command runs;
issue #9 adds `node dist/cli.js --help` as a CI smoke step for that class of
bug.

## Consequences

- The promise that a bare host needs only Docker, Git and a shell survives,
  narrowed to the commands where it actually matters.
- Two entry points to document, and a period where some commands exist in
  both implementations. The inventory in ADR 0014 is the checklist: a ported
  command deletes its Bash counterpart in the same change, except for the
  five zero-Node commands, which keep a Bash fallback.
- Clever entry points are where confusing failures live. The dispatcher is
  tested, not merely described.
- Publishing to npm still makes the TypeScript CLI a public artefact with
  SemVer obligations. Ship `0.x` and say so in the package description, as
  `README.md` already does for the project.

## Reversal conditions

Reconsider this decision if at least one of these becomes true:

1. Maintaining the Bash fallback for five commands costs more than asking
   operators to install Node 22, and the documented VPS path has moved on.
2. The dispatcher mis-detects Node often enough to be a support burden.
3. The TypeScript CLI is abandoned, in which case `bin/portta` simply
   stays the Bash tool and this record is superseded as "not done".
