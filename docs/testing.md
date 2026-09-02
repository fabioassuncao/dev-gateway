# Testing

One principle decides what to run and when:

> **While you are working, test what you changed. Before you hand it over,
> widen the scope to match the risk.**

The full local pass takes about a minute, and most of that minute is spent
re-proving things your change could not have touched. Running it after every
edit does not make the change safer; it makes the edit slower, which is what
makes people stop running tests at all.

## While you are working

Run the suite that covers the file you edited, and the tests you wrote for it.
Nothing else.

| You changed | Run | Cost |
| --- | --- | --- |
| `packages/core/src/*.ts` | `npm test --workspace=portta-core` | ~0.5s |
| `packages/cli/src/**` | `npm test --workspace=portta` | ~0.7s |
| `apps/auth/src/**` | `npm test --workspace=portta-auth` | ~0.5s |
| `apps/web/src/server/**` | `npm test --workspace=portta-web -- --project server` | ~1.5s |
| `apps/web/src/ui/**` | `npm test --workspace=portta-web -- --project ui` | ~3.5s |
| `scripts/lib/*.sh`, `bin/portta`, `install.sh` | `bash tests/unit/<subject>.test.sh` | 0.1–13s |
| `docker/compose/**`, `templates/**` | `bash tests/unit/profiles.test.sh` and `bash tests/unit/templates.test.sh` | ~6s |

Narrow further with a name filter, which every suite here accepts:

```bash
npm test --workspace=portta-web -- --project server apply   # one file
npm test --workspace=portta-core -- -t 'refuses'            # one description
```

Widen only when there is a concrete reason to think something else is affected:
a shared type, an exported helper with several callers, a change to
`packages/core` (which all three other workspaces import), or a compose overlay
that more than one profile selects.

Do **not** run `./tests/run.sh`, the end-to-end suites, or the Playwright run
for an ordinary fix, feature increment or refactor. They exist for the moments
below.

## Before you hand it over

Run the full local pass when you finish a feature, when the change is
structural or crosses workspace boundaries, when it touches something shared
(`packages/core`, `src/shared/types.ts`, a compose overlay, the installer), and
always before a merge or a release:

```bash
./tests/run.sh          # shell lint, compose validation, unit and workspace suites (~1 min)
```

The two expensive layers stay opt-in, because both need a Docker daemon and
both take minutes:

```bash
./tests/run.sh --e2e    # the gateway end to end, plus the panel in a browser
./tests/run.sh --all    # everything above in one run
```

CI runs all of it on every push, so the local end-to-end run is for when you
have a specific reason to believe it will fail — a change to the lifecycle
commands, the compose files, the installer, or the panel's routing.

## What belongs in the suite

The suite is small on purpose. Every test in it has to earn the time it costs
on every future run.

**Write a test when** it pins a business rule, a refusal, an exit code, a
security boundary, a data-loss path, or a bug that already happened once. The
shell audit suites (`tests/unit/audit.test.sh`, `install.test.sh`,
`web.test.sh`) are the clearest example: they assert invariants such as "no
prune, ever" and "no password on a command line" in milliseconds.

**Do not write a test that** restates the implementation, asserts a static
label or a class name, checks that a file exists next to another assertion that
reads it, covers browser plumbing with no rule behind it (`localStorage`,
`document.title`), or duplicates a decision another layer already asserts. When
the panel and the server both look at the same rule, the server test is the one
to keep: it runs in about 3ms, the component test in about 50ms.

Two implementations of one decision — the shell gateway and the TypeScript CLI,
per [ADR 0015](adr/0015-node-on-the-host.md) — are not duplication. Both are
shipped, so both are tested, and a parity assertion keeps them in step.

## Keeping it fast

The suite is only worth running often if it stays quick, so cost is part of
review:

- **One document per question, not one per assertion.** A `portta` invocation
  is a process spawn. `tests/unit/cli.test.sh` reads each command's help once
  and makes every assertion against that output.
- **Drive timers, do not wait on them.** `useApply` polls on a plain
  `setTimeout` loop precisely so a test can step it with `vi.useFakeTimers()`.
  Waiting on the real clock cost eight seconds for two tests.
- **Assert on the server where the rule lives.** A jsdom environment costs
  roughly ten times what a Node one does.
- **Watch the slowest file, not the total.** The suites run in parallel, so
  wall-clock time is the longest single file.

## Layers

| Layer | Where | Needs Docker | Runs in |
| --- | --- | --- | --- |
| Shared core | `packages/core/src/*.test.ts` | no | `tests/run.sh`, CI |
| CLI | `packages/cli/src/**/*.test.ts` | no | `tests/run.sh`, CI |
| ForwardAuth | `apps/auth/src/*.test.ts` | no | `tests/run.sh`, CI |
| Panel API | `apps/web/tests/server/` | no | `tests/run.sh`, CI |
| Panel components | `apps/web/tests/ui/` | no | `tests/run.sh`, CI |
| Shell gateway and invariants | `tests/unit/` | compose only | `tests/run.sh`, CI |
| Gateway end to end | `tests/e2e/` | yes | `--e2e`, CI |
| Panel in a browser | `apps/web/e2e/` | no (fake Engine API) | `--e2e`, CI |
