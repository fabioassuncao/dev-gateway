# 0008. The web panel gets its own Docker socket proxy

**Status:** Accepted

## Context

The panel exists to make a busy Docker host legible: which projects the gateway
routes, what else is running beside them, which port is already taken, and
where a database can be reached. Some of that is inherently write access:
restarting a service, stopping a container somebody forgot, removing one, and
opening a TCP bridge.

Traefik's socket proxy ([ADR 0002](0002-docker-socket-proxy.md)) is read-only,
deliberately: `POST: "0"` and every write flag off. Its permission set is a
promise, and it is one of the few things in this repository that would be
genuinely dangerous to loosen. Extending it so that the panel can restart a
container would extend it for Traefik too, and Traefik is the component with
the largest attack surface in the stack.

## Decision

The panel gets a **second** socket proxy of its own, on its own `internal`
network, reachable from nothing but the panel.

It grants the read endpoints the panel needs (containers, networks, events,
info, version, ping) plus the container lifecycle (`POST`, with
`ALLOW_START`, `ALLOW_STOP`, `ALLOW_RESTARTS`). Images, volumes, exec, build,
swarm, secrets, plugins and the system endpoints stay denied.

Traefik's proxy is untouched, and stays read-only.

Because `tecnativa/docker-socket-proxy` gates by path prefix and HTTP method,
`CONTAINERS: "1"` together with `POST: "1"` is broader than what the panel
needs: it would also forward `POST /containers/prune` and
`POST /containers/{id}/exec`. So the panel enforces a second, narrower layer in
its own process: a hard allowlist of (method, path) pairs in
`web/src/server/docker/allowlist.ts`, checked before any request is emitted.
A call not on that list never reaches the proxy.

The two layers together are what the panel is allowed to do:

| Operation | Proxy | Panel allowlist |
|---|---|---|
| List, inspect, logs, events, info | allowed | allowed |
| Start, stop, restart a container | allowed | allowed |
| Remove a container | allowed | allowed, always with `v=0&link=0` |
| Create a container | allowed | one shape only: the socat TCP bridge |
| `exec`, `prune`, `archive`, `attach` | partly reachable | **denied** |
| Images, volumes, build, swarm, secrets | denied | denied |

`exec` deserves a note: the proxy would forward `POST /containers/{id}/exec`
(it starts with `/containers`), but running one needs `POST /exec/{id}/start`,
which `EXEC: "0"` denies. The panel's allowlist denies both regardless.

## Consequences

There is one more container in the stack when the panel is enabled, and one
more place where socket permissions are declared. Both are worth it: the two
permission sets have different justifications and different blast radii, and
merging them would mean the stricter one is only as strict as the looser one.

`tests/unit/web.test.sh` asserts every flag in both directions, so a future
edit that grants the panel `IMAGES` or `VOLUMES`, or that adds an allowlist
rule for `/exec`, fails the build.

The panel needs no Docker socket, no Docker CLI and no host filesystem beyond
two files (`.env`, which its Settings page edits, and `VERSION`, which it
reads). It cannot pull an image, so `dev-gateway web up` pulls the bridge image
on the host, where the CLI already has real Docker access.
