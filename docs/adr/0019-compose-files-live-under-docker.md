# 0019. The compose files live under `docker/compose/`, one directory per axis

**Status:** Accepted

## Context

The gateway is not one Compose file. It is a base plus a set of overlays that
each contribute only the keys they change, per
[ADR 0003](0003-traefik-static-config-via-env.md). By the time the panel, TCP
routing and the Tailscale attachment existed, that had grown to **fifteen
`compose*.yaml` files sitting in the repository root**, next to `Makefile`,
`README.md` and everything else. The root stopped being scannable, and the
files gave no hint of the structure behind them: nothing in the flat listing
said that exactly one `attach-*` is always selected, or that
`compose.dashboard.yaml` and `compose.dashboard-tailscale.yaml` are two answers
to one question and never both.

The structure was never flat. Each file is chosen by a distinct condition in
`dg_compose_files`, and the conditions form a matrix with one axis per decision:

| Axis | Files | Selected by |
|---|---|---|
| Base | `compose.yaml` | always |
| Attachment | `attach/{host,tailscale}.yaml` | exactly one, always |
| Profile | `profiles/{local,local-tls,remote,public}.yaml` | the profile, plus TLS mode |
| Dashboard | `features/dashboard{,-tailscale}.yaml` | `DEV_GATEWAY_DASHBOARD` |
| TCP | `features/tcp{,-tailscale}.yaml` | `DEV_GATEWAY_TCP` |
| Panel | `features/{web,web-dev,web-vpn,db}.yaml` | `DEV_GATEWAY_WEB` and friends |

### Why the pairs are not consolidated

The obvious reading is that `dashboard.yaml` and `dashboard-tailscale.yaml` are
duplication waiting to be merged behind a Compose `profiles:` key. They are not.
Compose profiles gate **whole services**, not fragments of one. What differs
between the pair is which already-existing service carries the `ports:` entry:
`traefik` owns its network namespace under the host attachment, and owns nothing
under the Tailscale one, where `tailscale` publishes on its behalf
([ADR 0007](0007-tailscale-sidecar.md)). The same holds for the TCP pair. There
is no Compose construct that expresses "put this port on a different service
depending on an earlier overlay", so the pair is the mechanism, not an accident.

Merging them would mean changing behaviour. The problem to solve was layout.

### Why relative paths did not have to move with the files

The overlays carry seventeen relative bind mounts (`./config/traefik/dynamic`,
`./state/traefik/acme`, `./.env`, `./VERSION`, `./apps/web/src`,
`./packages/core/src`) and three build contexts of `context: .` that must be the
monorepo root, because `apps/web/Dockerfile` copies the workspace lockfile.

Compose resolves every relative path against the **project directory**, which
defaults to the directory of the first `-f` file — not the directory of the file
the path is written in. Moving the files would therefore have re-anchored all
twenty paths at `docker/compose/`. `--project-directory` overrides that default,
and it does not touch the project name, which `docker/compose/compose.yaml`
still declares explicitly as `name: ${DEV_GATEWAY_PROJECT_NAME:-dev-gateway}`.

## Decision

The gateway's compose files live under `docker/compose/`, in one directory per axis:

```
docker/
├── compose/
    ├── compose.yaml
    ├── attach/     host.yaml, tailscale.yaml
    ├── profiles/   local.yaml, local-tls.yaml, remote.yaml, public.yaml
    └── features/   dashboard.yaml, dashboard-tailscale.yaml, tcp.yaml,
                    tcp-tailscale.yaml, web.yaml, web-dev.yaml, web-vpn.yaml, db.yaml
└── examples/        self-contained demonstration stacks
```

The file names drop the `compose.` prefix and the axis name, both of which the
directory now carries: `compose.attach-host.yaml` is `attach/host.yaml`.

Every invocation passes `--project-directory <repository root>`, so the paths
inside the files keep resolving where they always did. This is done once on each
side of the contract: `dg_compose` in `scripts/lib/docker.sh`, and
`composeArguments` in `packages/cli/src/context.ts`.

Nothing was deleted, merged or renamed semantically. `git mv` carried the
history.

The runnable Compose examples live separately under `docker/examples/`. Their
supporting files move with them so relative bind mounts continue to resolve
inside each self-contained demo directory.

## Consequences

The root lists one `docker/` entry instead of fifteen files and the former
root-level examples tree. The nested directory names state the matrix that was
previously only readable in `dg_compose_files`.

**The selection logic still has two implementations that must agree**:
`dg_compose_files` in `scripts/lib/docker.sh` and `composeFiles` in
`packages/core/src/config.ts`, per
[ADR 0015](0015-node-on-the-host.md) — the core commands must run without Node.
This decision did not create that duplication, but it doubled the cost of this
particular change, and `tests/unit/profiles.test.sh` remains the thing that
keeps the two honest.

`packages/cli/src/context.ts` locates a gateway checkout by looking for a
Compose file under `docker/compose/`. A published CLI outlives the checkout it
is pointed at in both directions, so earlier layouts remain recognised during
root discovery.

Anyone who was invoking `docker compose -f compose.yaml -f compose.local.yaml`
by hand needs the new paths. That was never the supported interface — the base
file says so in its header, and the CLI is the stable operational contract — but
it is the one thing this change breaks. `make` and `./bin/dev-gateway` are
unaffected, and so are consumer projects: `compose.dev-gateway.yaml` lives in
the adopted project, not here.
