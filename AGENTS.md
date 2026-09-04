# Agent index

Rules live next to the work they govern. This file is an index, not a second
copy of them.

- [Safe operating rules](docs/agent-guidelines.md) — what an agent must never do on a shared development host
- [Monorepo layout](docs/monorepo.md) — where new code goes, and how to add a command
- [Shell scripts](docs/scripts.md) — what may still be Bash, and why a new one probably may not
- [Testing](docs/testing.md) — what to run while working, and what to run before merging
- [Architecture decisions](docs/adr/) — decisions that are expensive to reverse
- [Documentation index](docs/README.md)

Per-directory `AGENTS.md` files are added only when a workspace has rules that
are not true of the rest of the repository.

## Running tests

The one rule that changes how a session feels:

> **While you are working, run only what covers what you changed. Before you
> hand it over, widen the scope to match the risk.**

During an ordinary implementation, fix or refactor, run:

- the suite that owns the file you edited,
- the tests you wrote for the change,
- and anything else only when you can name the reason it might be affected.

Do **not** run the whole suite, the end-to-end suites or the Playwright run on
every edit. They cost a minute or more; the targeted run costs under a second.

| You changed | Run |
| --- | --- |
| `packages/core/src/**` | `npm test --workspace=portta-core` |
| `packages/contracts/src/**` | `npm test --workspace=portta-contracts` and `npm run openapi:check --workspace=portta-contracts` |
| `packages/db/src/schema/**` | `npm test --workspace=portta-db` and `npm run db:check --workspace=portta-db` |
| `packages/server/src/**` | `npm test --workspace=portta-server` |
| `packages/cli/src/**` | `npm test --workspace=portta` |
| `apps/auth/src/**` | `npm test --workspace=portta-auth` |
| `apps/web/{app,components,lib}/**` | `npm test --workspace=portta-web -- --project ui` |
| `apps/web/server/**` | `npm test --workspace=portta-web -- --project server` |
| `apps/web/lib/docs/**` | `npm test --workspace=portta-web -- --project docs` |
| an API route or a service | also `npm run openapi:check --workspace=portta-contracts` |
| `scripts/`, `bin/portta`, `install.sh` | `bash tests/unit/<subject>.test.sh` |
| `docker/compose/`, `templates/` | `bash tests/unit/profiles.test.sh`, `bash tests/unit/templates.test.sh` |

Append a filename or `-t <name>` to narrow further:
`npm test --workspace=portta-server -- apply`.

Run `./tests/run.sh` when you finish a feature, when the change is structural
or touches something shared (`packages/core`, `packages/contracts`, a compose
overlay, the installer), and before a merge or a release. It also runs
`tests/unit/boundaries.test.sh`, which fails when an import crosses a workspace
boundary the [map](docs/monorepo.md) does not allow.

**Nothing runs these for you.** The only workflow left publishes the Docker
image; there is no CI that re-checks a push. Run `--e2e` before a merge that
touches the lifecycle commands, the compose files, the installer or the panel's
routing, and `--all` before a release.

[docs/testing.md](docs/testing.md) has the costs of each layer, and what does
and does not deserve a test.
