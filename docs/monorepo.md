# Monorepo layout

Where new code goes, and how a command is added. The decisions behind this
page are [ADR 0014](adr/0014-monorepo-and-the-typescript-cli.md) and
[ADR 0015](adr/0015-node-on-the-host.md).

The panel lives at `apps/web`. Shared logic that a second consumer needs
goes in `packages/core`. The TypeScript CLI lives in `packages/cli` and is
configured for unscoped publication as `portta`. `npm ci` at the repository root installs every
workspace from one lockfile. The lockfile must keep optional native bindings
for Linux: `npm install` on macOS workspaces otherwise drops them, and the
Alpine panel image cannot build Vite.

## Map

```text
portta/
├── apps/web/                the panel (Hono API, React UI, PostgreSQL)
├── packages/core/           portta-core — shared domain logic (private)
├── packages/cli/            portta — TypeScript CLI
├── bin/portta          Bash entry point; delegates when Node is present
├── scripts/                 Bash commands; shrinks as they migrate
├── docker/
│   ├── compose/              gateway Compose base and overlays
│   ├── images/               operational image contexts (apply, toolbox)
│   └── examples/             self-contained demonstration stacks
├── config/, docs/, tests/, templates/
└── package.json             workspaces: ["apps/*", "packages/*"]
```

| Workspace | Name | Published | Holds |
|---|---|---|---|
| `apps/web` | `portta-web` | no | Panel server, UI, migrations, Dockerfile, panel tests |
| `packages/core` | `portta-core` | no | `env`, `config`, `docker`, `inventory`, `traefik`, `schemas` |
| `packages/cli` | `portta` | ready, not published by repository changes | Commands, formatting, process execution, provisioning |

`bin/` and `scripts/` stay at the root. They are not a workspace.

## The one rule

> **Local facts come from Core, executed locally. Persistent decisions come
> from the API. Nothing is implemented twice.**

The CLI never opens PostgreSQL. The panel is the only writer of durable
decisions ([ADR 0013](adr/0013-what-the-panel-persists.md)). Docker inventory,
URLs, `.env`, `doctor`, Git collection, `bootstrap` / `up` / `down` run
locally through core.

## Where new code goes

| You are adding… | It belongs in… |
|---|---|
| A panel page, route, or React component | `apps/web` |
| A Zod schema shared by the API and a CLI command | `packages/core` `schemas`, once the CLI needs it; until then `apps/web/src/shared` |
| Parsing `.env`, inventory, Traefik files, the Docker allowlist | `packages/core`, the first time a second consumer needs it |
| A CLI command | `packages/cli` `src/commands/`, colocated `*.test.ts` |
| Host diagnostics, Compose, filesystem provisioning | `packages/cli` calling `packages/core` |
| `openssl`, `ssh`, or a one-shot `docker run` wrapper | Bash under `scripts/`, if shell is the right interface |
| Persistent settings, project overrides, integrations | The panel API, never a second database client |
| A document | `docs/`, linked from [docs/README.md](README.md) |

Do not put panel-only code in `packages/core` "for later". A module enters
core when a second consumer exists, not in anticipation.

## How to add a command

1. Decide the path with the rule above. If the command needs a fact from
   Docker, Git or the host, it runs locally. If it needs a preference stored
   by the panel, it calls the API.
2. If the behaviour already exists in Bash, read the inventory in
   [ADR 0014](adr/0014-monorepo-and-the-typescript-cli.md). Port or keep; do
   not wrap.
3. If the behaviour already exists in the panel, extract the shared function
   into `packages/core` in the same change that the CLI starts calling it.
4. Put the command module at `packages/cli/src/commands/<name>.ts` with a
   colocated test. Headless-first: plain output, colour only when `stdout` is
   a TTY, `--json` for agents.
5. Delete the Bash counterpart in the same change, unless it is one of the
   zero-Node commands in [ADR 0015](adr/0015-node-on-the-host.md)
   (`bootstrap`, `up`, `down`, `status`, `doctor`). Those keep a Bash
   fallback.
6. `node dist/cli.js --help` must still start. A load-time defect is invisible
   to unit tests that never import the entry point.

## Node on the host

The host does not need Node for `bootstrap`, `up`, `down`, `status` and
`doctor`. The full TypeScript CLI needs Node 22.12+. The unscoped npm package
and the binary are both named `portta`.
Details in [ADR 0015](adr/0015-node-on-the-host.md).

## AGENTS.md

The root `AGENTS.md` is an index. It holds no rules of its own. Per-directory
`AGENTS.md` files are added only when a workspace has rules that are not true
of the rest of the repository, starting with `packages/cli` and
`packages/core` when they gain code. Document once; reference everywhere it
is needed. The operating rules for agents on a shared host already live in
[agent-guidelines.md](agent-guidelines.md).
