# 0029. Shell is for bootstrap; TypeScript is the default

**Status:** Accepted

## Context

[ADR 0014](0014-monorepo-and-the-typescript-cli.md) created the workspace and
carried a per-file verdict for every script that existed when it was written.
[ADR 0015](0015-node-on-the-host.md) decided that five commands must keep
working on a host with no Node. Issue #9 built `packages/cli` against both.

What neither record decided is the rule that applies to the *next* script.
ADR 0014's inventory names thirteen files that no longer exist, gives line
counts that have since moved by hundreds of lines, and marks three files
**Keep as shell** with a one-line reason that was never tested against a real
Node implementation. Four scripts written after it — `tunnel.sh`,
`maintenance.sh`, `capabilities.sh`, `apply.sh` — never received a verdict at
all, and neither did `install.sh` or `auth.sh`.

An undocumented boundary drifts, and this one had already shipped a defect.
`bin/portta` delegates to the TypeScript CLI whenever Node 22.12+ and
`dist/cli.js` are both present, which is every developer machine and every host
the installer touched. The Bash dispatcher implemented `tunnel`, `backup`,
`restore` and `repair`; Commander registered none of them. Documented commands
exited 2 with `unknown command`, their implementations intact and reachable
only through the undocumented `PORTTA_FORCE_BASH=true`. Nothing in the test
suite could see it, because nothing asserted that the two command sets are the
same set.

## Decision

**Shell is for bootstrap and for the zero-Node contract. TypeScript is the
default for everything else Portta automates.**

A `.sh` file survives only if at least one of these holds:

- **(a)** it runs before Node can be assumed present;
- **(b)** it is the interface to something Node cannot reach without adding a
  dependency the project has refused;
- **(c)** the Node equivalent measurably increases complexity for no
  behavioural gain.

Being the interface to an *external binary* is not one of them. `execa` runs
`openssl`, `ssh`, `docker` and `cloudflared` with argument arrays, no shell,
and better error handling than `set -euo pipefail` — so "it drives `openssl`"
and "`ssh` is the interface" do not justify shell on their own.

Two entry points stay, and they must offer the same commands. A name the Bash
dispatcher knows and Commander does not is a defect, not a fallback:
`tests/unit/cli.test.sh` fails when the two disagree.

### Verdicts

| File | Lines | Verdict | Reason |
|---|---:|---|---|
| `install.sh` | 1426 | **Stays shell, shrinks hard** | (a) `curl … \| bash` on a host with nothing. Its job ends at: detect the environment, install requirements, fetch Portta, prepare the minimum, hand over to the CLI |
| `bin/portta` | 697 | **Stays shell, shrinks** | (a) the ADR 0015 dispatcher. Its Bash fallback set stays exactly the commands ADR 0015 names |
| `scripts/bootstrap.sh` | 177 | **Stays shell, shrinks to the zero-Node fallback** | (a) ADR 0015 |
| `scripts/doctor.sh` | 1119 | **Stays shell, shrinks to the zero-Node fallback** | (a) ADR 0015. A bare host is diagnosed before anything is installed; that is a handful of checks, not a thousand lines |
| `scripts/lib/toolbox.sh` | 73 | **Stays shell** | (b) the `docker run` wrapper the zero-Node path needs |
| `scripts/lib/auth.sh` | 25 | **Stays shell** | (a) it renders the middleware file `bootstrap.sh` needs before the panel exists |
| `scripts/lib/apply.sh` | 143 | **Stays shell, as a fallback of a TypeScript contract** | (a) preparing the applier is part of what `up` does, and `up` is an ADR 0015 command. `packages/core/src/apply.ts` is the source of truth; `tests/unit/apply.test.sh` runs both and compares the `docker create` argument lists |
| `scripts/lib/common.sh` | 466 | **Migrate** | → `packages/core`, keeping the output helpers and `portta_load_env` for the fallback |
| `scripts/lib/docker.sh` | 471 | **Migrate** | → `packages/core` (pure) and `packages/cli` (effects) |
| `scripts/lib/discovery.sh` | 193 | **Migrate** | → `packages/core`, keeping the container lookups `doctor` calls |
| `scripts/lib/capabilities.sh` | 256 | **Delete** | Sourced by nothing but its own test. Its probes become `packages/cli/src/detect.ts`; nothing in the zero-Node command set reads a capability, so (a) never applied |
| `scripts/cmd/tunnel.sh` | 387 | **Migrate** | → `packages/cli`; `packages/core/src/tunnel.ts` already holds the config, token and state model |
| `scripts/cmd/maintenance.sh` | 324 | **Migrate** | → `packages/cli` |
| `scripts/cmd/tls.sh` | 215 | **Migrate** | → `packages/cli`, keeping the toolbox container as the `openssl` runner |
| `scripts/cmd/remote.sh` | 217 | **Migrate** | → `packages/cli`; `ssh` through `execa`, host keys still verified |
| `scripts/cmd/remote-access.sh` | 208 | **Migrate** | → `packages/cli` |

Measured 2026-09-02. `docs/scripts.md` carries the live inventory, the call
graph and the rule; this record carries the decision.

**"Migrate" does not mean "delete the fallback".** Where ADR 0015 requires a
command to work with no Node, the shell keeps an implementation — but it stops
being a *source of truth*, shrinks to what the fallback actually calls, and is
pinned to the TypeScript version by a test that runs both and compares the
results. A comment asking a human to keep two files in step is not that test,
and is treated as an unfinished port.

### What this does not decide

ADR 0015 is untouched. The zero-Node commands keep working with Node absent
from `PATH`, and "migrate" never means "delete the fallback": it means the
shell copy stops being the source of truth and shrinks to the contract ADR 0015
names.

## Consequences

Every later port has one written criterion instead of a per-file argument, and
a new automation has an obvious home. The four restored commands are
passthroughs to their shell implementations — the shape ADR 0014 rightly calls
a smell — and are load-bearing only until each is ported, at which point the
wrapper is deleted by the change that replaces it.

The rule will occasionally be argued with. That is cheaper than arguing per
file, and the argument now has to move a record rather than a comment.

ADR 0014's inventory table is superseded by this record. The rest of ADR 0014 —
the workspace layout and the Core / CLI / API boundaries — stands.

## Reversal conditions

Revisit if the zero-Node contract in ADR 0015 is itself reversed, in which case
(a) stops justifying anything and `install.sh`, `bin/portta`, `bootstrap.sh`
and `doctor.sh` become ordinary migration candidates. Revisit also if a port
under (c) demonstrably lands worse than the shell it replaced: that is evidence
about the rule, and it belongs here rather than in a review thread.
