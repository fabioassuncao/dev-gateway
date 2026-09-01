# 0014. The repository is a small npm workspace, with a shared core

**Status:** Accepted

Issue #8 landed this layout. The diagnosis below is the state the decision
was made against.

## Context

The gateway has two interfaces and no shared layer. There is a 6,883-line Bash
CLI under `bin/` and `scripts/` (23 files, counted 2026-09-01), and a TypeScript
panel under `web/` with its own server, Docker client, Traefik client, Git
reader and share manager. They overlap in intent — both discover projects, both
read Traefik labels, both diagnose — and share not one line of code.

`apps/web/src/server/config.ts` says it out loud: *"Defaults mirror `dg_defaults` in
`scripts/lib/common.sh`: keep them in sync."* That comment is the whole argument
for a shared package.

There is no root `package.json`. `web/` is the only Node package. Adding an
official TypeScript CLI ([issue #9](https://github.com/fabioassuncao/dev-gateway/issues/9))
on top of that is not a packaging exercise; it is a decision about what the
Dev Gateway is. This record decides the layout, the workspace responsibilities,
the CLI / API / Core rule, and the npm name. [ADR 0015](0015-node-on-the-host.md)
decides what happens on a host without Node. Issue #8 is the mechanical
move this record specified.

The unscoped name `dev-gateway` is taken on npm by an unrelated tool
(`dev-gateway@0.3.0`, maintainer `paloskin`, last published 2022-06-15, verified
again 2026-09-01). `@fabioassuncao/dev-gateway` is unpublished.

## Decision

### Layout

```text
apps/
  web/                      ← today's web/, moved wholesale by issue #8
packages/
  core/                     ← @dev-gateway/core   (private)
  cli/                      ← @fabioassuncao/dev-gateway (published by #9)
bin/dev-gateway             ← stays; see ADR 0015
scripts/                    ← shrinks as commands migrate
compose*.yaml, config/, docs/, tests/, examples/   ← unchanged, at the root
```

npm workspaces, not pnpm or Turborepo. The repository has one Node package
today, `package-lock.json` is what CI caches, and the panel's Dockerfile
does `npm ci`. A second package manager is a separate decision.

The panel stays at `apps/web`, not `apps/panel`. Renaming it would rewrite
every document that already calls the directory `web/`, on top of moving it.
The directory name is historical; the product name remains "the panel".

`bin/` and `scripts/` stay at the root. Moving them under `packages/cli` would
rewrite every path in the Bash tool, in `tests/run.sh`, in CI and in every
document, while issue #9 is about to rewrite those commands anyway.

### Workspace responsibilities

**`apps/web`** — the administration panel. Hono API, React UI, PostgreSQL, the
OpenAPI document, the Dockerfile. It is the only writer of persistent
decisions ([ADR 0013](0013-what-the-panel-persists.md)).

**`packages/core`** — logic both the panel and the CLI need, extracted from
code that already exists, and only when a second consumer needs it. The
initial modules, named so they are not a dumping ground:

| Module | Taken from | Replaces |
|---|---|---|
| `env` | `apps/web/src/server/core/envfile.ts` | `dg_load_env`, `dg_env_set` |
| `config` | `apps/web/src/server/config.ts` | `dg_defaults()` |
| `docker` | `apps/web/src/server/docker/` | allowlisted client; the allowlist is a *parameter*, so the CLI can hold a wider one without weakening [ADR 0008](0008-web-panel-socket-proxy.md) |
| `inventory` | `apps/web/src/server/core/inventory.ts` | `dg_discover_http`, `urlsFor`, `hostsFromRules` |
| `traefik` | `apps/web/src/server/core/dynamic.ts`, `core/traefik.ts` | panel and CLI writers of the two generated files |
| `schemas` | `apps/web/src/shared/types.ts` | the Zod contract issue #6 already made the source of truth |

A module enters core only when a second consumer needs it. Panel-only code
(routes, React, the database access layer, OpenAPI generation) stays in
`apps/web`.

**`packages/cli`** — commands, output formatting, process execution,
provisioning. It imports core. It talks to the panel over HTTP for persistent
decisions. It never opens PostgreSQL.

No `packages/api-client` yet: the CLI reaches the panel at a handful of
endpoints, and issue #6 already publishes an OpenAPI document. Add the package
when there is a second consumer, not before.

No `packages/db`: persistence stays inside the panel.

### CLI vs API vs Core

> **Local facts come from Core, executed locally. Persistent decisions come
> from the API. Nothing is implemented twice.**

| Operation | Path | Why |
|---|---|---|
| Docker inventory, project discovery, URLs | Core, locally | The CLI has the user's Docker access; the panel may not even be running |
| Host diagnostics (`doctor`) | Core, locally | `PATH`, listening sockets, DNS, certificate files — invisible from a container |
| Git collection | Core, locally | [ADR 0010](0010-git-collected-on-the-host.md) already puts this on the host |
| `bootstrap`, `up`, `down`, `setup` | Core, locally | Compose and the host filesystem |
| `.env` reads and writes | Core, locally | The file is on the host; the panel writes the same file through the same rules |
| Panel settings, project overrides, aliases, integrations, tasks | **API** | Issues #4 and #5 put these in the panel's database; the CLI must not open a second connection to it |

The last row is the rule that matters: **the CLI never talks to PostgreSQL.**
One writer, one set of validations, one place where an override is turned into
a Traefik file. [ADR 0013](0013-what-the-panel-persists.md) already states this;
this record makes it a workspace boundary.

### Naming

- **Published package:** `@fabioassuncao/dev-gateway`. Scoped, unambiguous,
  unaffected by the squatted `dev-gateway@0.3.0`.
- **Binary:** `dev-gateway`. Every command in `README.md` and under `docs/`
  keeps working verbatim. The package name and the binary name are independent:
  `bin: { "dev-gateway": "./dist/cli.js" }`.
- **`npx @fabioassuncao/dev-gateway setup`** for provisioning on a host that
  already has Node.
- **Internal packages** stay private: `@dev-gateway/core` with `"private": true`,
  published only if something outside this repository ever needs it.

### What is duplicated today

Behaviours implemented in both languages, counted 2026-09-01. Each row is a
candidate for `packages/core`, extracted the first time a CLI command needs it,
never as a big-bang refactor.

| Concern | Bash | TypeScript |
|---|---|---|
| Discover routed services | `dg_discover_http` in `scripts/lib/discovery.sh` | `urlsFor()` / `hostsFromRules()` in `apps/web/src/server/core/inventory.ts` |
| Read and write `.env` | `dg_load_env`, `dg_env_set` in `scripts/lib/common.sh` | `parseEnv`, `setEnvValue` in `apps/web/src/server/core/envfile.ts` |
| Defaults | `dg_defaults()` in `scripts/lib/common.sh` | `loadConfig()` in `apps/web/src/server/config.ts` |
| Compose attachment | `dg_attachment` in `scripts/lib/docker.sh` | the same function in `apps/web/src/server/config.ts` |
| Hostname slug | `dg_slug` in `scripts/lib/common.sh` | `apps/web/src/shared/slug.ts` |
| Datastore kinds | `scripts/lib/discovery.sh` | `apps/web/src/server/core/kinds.ts` |
| Diagnostics | `scripts/doctor.sh` | `apps/web/src/server/core/diagnostics.ts` |
| Panel BasicAuth hash | `dev-gateway web auth set` (`openssl passwd -apr1`) | `apps/web/src/server/core/apr1.ts` |
| Traefik dynamic files | `dev-gateway web auth apply` | `apps/web/src/server/core/dynamic.ts` |
| Share files | `scripts/cmd/share.sh` | `apps/web/src/server/core/shares.ts` |
| Remote URL parsing | `scripts/cmd/git.sh` | `apps/web/src/server/core/forge.ts` |

### Script inventory

Every file under `bin/` and `scripts/`, with a verdict. A command is either
ported or it stays Bash. A TypeScript function that shells out to
`scripts/cmd/foo.sh` is a migration step, never a destination, and each one is
removed in the same change that ports it.

| File | Lines | Verdict | Reason |
|---|---:|---|---|
| `bin/dev-gateway` | 605 | **Keep, shrink** | Becomes the delegating entry point in ADR 0015 |
| `scripts/lib/common.sh` | 288 | **Migrate** | → `packages/core` `env` and `config` |
| `scripts/lib/docker.sh` | 390 | **Migrate** | → `packages/core` `docker` |
| `scripts/lib/discovery.sh` | 187 | **Migrate** | → `packages/core` `inventory` (already exists there) |
| `scripts/lib/toolbox.sh` | 72 | **Keep as shell** | A `docker run` wrapper and nothing else |
| `scripts/bootstrap.sh` | 163 | **Migrate**, keep a Bash fallback | Host preparation; must work without Node |
| `scripts/doctor.sh` | 808 | **Migrate last** | Largest and highest-value port; every check becomes a testable function |
| `scripts/cmd/web.sh` | 568 | **Migrate** | → `dev-gateway web *` |
| `scripts/cmd/access.sh` | 439 | **Migrate** | Identical labels, so the panel keeps managing the same bridges |
| `scripts/cmd/git.sh` | 456 | **Migrate** | A JSON producer is better typed than shelled |
| `scripts/cmd/analyze.sh` | 431 | **Migrate** | Heavy parsing, the worst fit for Bash |
| `scripts/cmd/dns.sh` | 276 | **Migrate** | HTTP and JSON |
| `scripts/cmd/service-publish.sh` | 250 | **Migrate** | Persistent private forwarders |
| `scripts/cmd/share.sh` | 219 | **Migrate** | Already duplicated with `apps/web/src/server/core/shares.ts` |
| `scripts/cmd/tls.sh` | 215 | **Keep as shell** | An `openssl` driver |
| `scripts/cmd/init.sh` | 215 | **Migrate** | Scaffold a project overlay |
| `scripts/cmd/remote.sh` | 217 | **Keep as shell** | `ssh` is the interface |
| `scripts/cmd/remote-access.sh` | 208 | **Keep as shell** | Same reason |
| `scripts/cmd/clients.sh` | 365 | **Migrate** | Database client hints |
| `scripts/cmd/public.sh` | 151 | **Migrate** | Public exposure opt-in |
| `scripts/cmd/namespace.sh` | 130 | **Migrate** | Derive a namespace from repo and branch |
| `scripts/cmd/network.sh` | 119 | **Migrate** | Shared network management |
| `scripts/cmd/services.sh` | 111 | **Migrate** | List services |

Roughly 4,500 lines migrate, ~700 stay as shell because shell is the right
interface for `openssl`, `ssh` and `docker run`, and the dispatcher plus libs
collapse into `packages/core` and a thin entry point.

### Issue Flow, as a reference

Read at `fabioassuncao/issue-flow@main` on 2026-09-01.

**Reuse:** packaging and CI discipline (`prepack` / `prepublishOnly`, an
explicit `files` allowlist, git-version hooks, `node dist/cli.js --help` as a
CI smoke step, an OS × Node matrix); `src/commands/` with colocated tests;
`commander`, `execa` and `zod`; AGENTS.md as an index that holds no rules of
its own.

**Do not reuse:** the single-package layout (Dev Gateway needs real workspaces
to share code between three consumers); Biome (Bash is linted with ShellCheck
and JS linting is a separate decision); `chalk` / `ora` / `listr2` (a gateway
CLI must be headless-first: plain output, colour only when `stdout` is a TTY);
the pipeline domain model.

### Sequencing

Issues #1, #4 and #6 are complete and already edit under `web/`. Issue #5 is
still open and will keep editing the panel. The directory move (#8) is one
mechanical commit, merged fast, before further broad work under `web/`.
Extraction into `packages/core` is not part of the move. It happens
incrementally, one module at a time, each time a CLI command needs it.

The unpublished TypeScript CLI stays out of `README.md` until issue #9 ships
it ([issue #11](https://github.com/fabioassuncao/dev-gateway/issues/11)).

## Consequences

- A developer or an agent asked to add a command knows which workspace it
  belongs in, whether it runs locally or through the API, and whether the Bash
  version is deleted in the same change. See [docs/monorepo.md](../monorepo.md).
- `dg_defaults` / `loadConfig` and `dg_discover_http` / `urlsFor` stop being
  kept in step by a comment, once the extraction actually happens.
- Issue #8 converts the repository to workspaces against this layout.
  Issue #9 publishes `@fabioassuncao/dev-gateway`.
- The `exposure` and `audit` CI jobs assert behaviour, not implementation, and
  must stay green through every migration change.
- [ADR 0016](0016-state-that-could-be-shared.md) depends on the state model
  sketched here: local facts from Core, persistent decisions from the API.
