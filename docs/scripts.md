# Shell scripts: what is left, and why

Portta has two entry points that must offer the same commands, and a shrinking
set of shell files behind one of them. This document is the live inventory.
[ADR 0029](adr/0029-shell-only-for-bootstrap.md) is the decision it executes;
[ADR 0015](adr/0015-node-on-the-host.md) is the constraint that keeps any of it.

## The rule

> Shell is for bootstrap and for the zero-Node contract. TypeScript is the
> default for everything else Portta automates.

A `.sh` file survives only if at least one holds:

- **(a)** it runs before Node can be assumed present;
- **(b)** it is the interface to something Node cannot reach without a
  dependency the project has refused;
- **(c)** the Node equivalent measurably increases complexity for no
  behavioural gain.

Being the interface to an *external binary* is not one of them. `execa` runs
`openssl`, `ssh`, `docker` and `cloudflared` with argument arrays and no shell.

## The call graph

```text
install.sh ──> fetch PORTTA_HOME ──> bin/portta
                                        │
bin/portta ──(Node 22.12+ and dist/cli.js present)──> packages/cli/dist/cli.js
     │                                                    │
     │                                                    ├─> packages/core
     │                                                    ├─> docker / git / fs
     │                                                    └─> legacy() ──┐
     │                                                                    │
     └──(no Node, or PORTTA_FORCE_BASH=true)──> scripts/lib/*.sh <────────┘
                                                       └──> scripts/cmd/*.sh
```

Three places still cross from TypeScript back into Bash. Each is a migration
step with an owning issue, never a destination:

| Crossing | Where | Removed by |
|---|---|---|
| `bash scripts/doctor.sh --json`, parsed | `packages/cli/src/commands/lifecycle.ts` | #30 |
| `legacy()` re-invokes `bin/portta` with `PORTTA_FORCE_BASH=true` | `packages/cli/src/commands/web.ts` | #29, except `toolbox` |
| `DetectedFacts` derived from `scripts/lib/capabilities.sh` JSON | `packages/core/src/capabilities.ts` | #28 |

`packages/core/src/apply.ts` also runs `bin/portta up` inside the applier
container. That is the applier's contract, not a fallback, and it stays.

## The inventory

Measured 2026-09-02, on `develop`.

### Stays shell

| File | Lines | Which test it passes | Bound |
|---|---:|---|---|
| `install.sh` | 1426 | (a) `curl … \| bash` on a host with nothing | Shrinks to: detect, install requirements, fetch Portta, prepare the minimum, `exec` the CLI (#30) |
| `bin/portta` | 697 | (a) the ADR 0015 dispatcher | Its Bash fallback set stays exactly the commands ADR 0015 names |
| `scripts/doctor.sh` | 1119 | (a) a bare host is diagnosed before anything is installed | Shrinks to the zero-Node checks (#30) |
| `scripts/bootstrap.sh` | 177 | (a) ADR 0015 | Shrinks to the zero-Node fallback (#30) |
| `scripts/lib/toolbox.sh` | 73 | (b) the `docker run` wrapper the zero-Node path needs | — |
| `scripts/lib/auth.sh` | 25 | (a) renders the middleware file `bootstrap.sh` needs before the panel exists | — |

### Migrates

| File | Lines | Destination | Issue |
|---|---:|---|---|
| `scripts/lib/apply.sh` | 143 | delete; `packages/core/src/apply.ts` already mirrors it | #28 |
| `scripts/lib/discovery.sh` | 193 | `packages/core/src/discovery.ts` | #28 |
| `scripts/lib/capabilities.sh` | 256 | `packages/cli/src/detect.ts`, filling `DetectedFacts` | #28 |
| `scripts/lib/common.sh` | 466 | `packages/core` (`env`, `config`), `packages/cli/src/host.ts`; output helpers stay for the fallback | #28 |
| `scripts/lib/docker.sh` | 471 | `packages/core/src/config.ts` (pure), `packages/cli/src/docker.ts` (effects) | #28 |
| `scripts/cmd/tls.sh` | 215 | `packages/cli/src/commands/tls.ts` | #29 |
| `scripts/cmd/remote-access.sh` | 208 | `packages/cli` | #29 |
| `scripts/cmd/remote.sh` | 217 | `packages/cli` | #29 |
| `scripts/cmd/maintenance.sh` | 324 | `packages/cli` | #29 |
| `scripts/cmd/tunnel.sh` | 387 | `packages/cli`, over `packages/core/src/tunnel.ts` | #29 |

## Behaviour that still lives in two places

Each of these is a comment holding two implementations together. The port that
removes the duplication deletes the comment; a surviving comment means the port
is unfinished.

- `packages/core/src/config.ts` (`composeFiles`) ↔ `portta_compose_files`
- `apps/web/src/server/config.ts` (`attachment`) ↔ `portta_attachment`
- `apps/web/src/shared/slug.ts` ↔ `portta_slug`
- `apps/web/src/server/core/kinds.ts` ↔ the kind table in `scripts/lib/discovery.sh`
- `apps/web/src/server/config.ts` ↔ the bridge image pinned in `scripts/lib/discovery.sh`
- `packages/core/src/apply.ts` ↔ `scripts/lib/apply.sh`
- `packages/core/src/capabilities.ts` ↔ `scripts/lib/capabilities.sh`

## The two surfaces must agree

`bin/portta` hands over to the TypeScript CLI whenever Node is present, so a
command the dispatcher names and Commander does not is unreachable on every
host the installer touched. `tunnel`, `backup`, `restore` and `repair` were
exactly that for one release: intact implementations behind `unknown command`
and exit 2.

`tests/unit/cli.test.sh` now fails when a name in `bin/portta`'s dispatch block
is missing from the Commander tree, in either of the block's two halves — the
arms that run a shell implementation, and the arms that report that the full
CLI is required.

A passthrough is also transparent, and tested as such: it forwards `--help` to
the implementation rather than answering with Commander's stub, and it adopts
the child's exit code instead of rewriting every failure as a precondition.

## Adding a script

Don't, unless it passes (a), (b) or (c) above. A new automation belongs in
`packages/cli`, with anything derivable in `packages/core`. If you believe a
new `.sh` is justified, add it here with the test it passes, in the same change
that adds the file.
