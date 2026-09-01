# 0011. The panel reads Traefik's API, and writes exactly three generated files

**Status:** Accepted

## Context

The panel reconstructs Traefik's routing decision from labels. `urlsFor()` and
`hostsFromRules()` mirror what Traefik does: an explicit ``Host(`...`)`` wins,
otherwise the default rule derives `<project>-<service>.<domain>`
([ADR 0005](0005-hostname-convention.md)). The mirror is faithful, and it is
also the blind spot. It reports what Traefik *should* do and never asks what it
*did*, so when the labels look right and the hostname still 404s, the panel has
nothing left to say.

In the other direction, the panel cannot change exposure at all. Routing is
opted into per container by labels the project owns, Docker has no API to
mutate a label on a running container, and recreating one would mean driving
Compose, which [ADR 0001](0001-decoupled-infrastructure.md) forbids. The
choices available today are "not routed", "routed on the VPN" and
"`PUBLIC_ENABLED=true`, so every opted-in service on the host is on the
internet". There is no per-service grain and no expiry.

Traefik's file provider is the missing half of both. `config/traefik/dynamic/`
is already watched (`TRAEFIK_PROVIDERS_FILE_WATCH: "true"`) and already
hot-reloaded, it defines routers and services and not only middlewares, and it
is mounted read-only into Traefik. The panel does not mount it at all.

## Decision

### Reading: Traefik's verdict, over the shared network

The panel reads `/api/http/routers`, `/api/http/services` and
`/api/http/middlewares` and uses them for the one thing labels cannot give: the
router name Traefik actually built, its rule, its entrypoints, its middlewares,
and its `status` with Traefik's own error text when a router was rejected.

It reaches that API over the shared `gateway` network it is already on, at a
base URL resolved per attachment and overridable with `DG_WEB_TRAEFIK_API`:

| Attachment | Base URL | Why |
|---|---|---|
| `docker/compose/attach/host.yaml` | `http://traefik:8080` | Traefik has its own namespace |
| `docker/compose/attach/tailscale.yaml` | `http://tailscale:8080` | Traefik shares the Tailscale container's namespace and has no name of its own ([ADR 0007](0007-tailscale-sidecar.md)) |

**Not over `control`.** Attaching the panel to the control network would be
narrower in one sense and much wider in the one that matters: `control` is
where Traefik's read-only socket proxy lives, and putting a second Docker
permission set within the panel's reach is the exact separation
[ADR 0008](0008-web-panel-socket-proxy.md) exists to keep. The shared network
grants the panel nothing it does not already have.

This layer exists only when `DEV_GATEWAY_DASHBOARD=true`, which is off by
default, so the UI has to handle its absence rather than assume it. The read is
cached on its own short TTL, has its own timeout, and never runs inside
`createSnapshotCache`: a slow or dead Traefik API must not delay a page. A
failed fetch degrades to today's label-derived view.

Two things are deliberately not built. **No embedded or iframed dashboard:**
it would need the insecure-mode API exposed more widely than today, it fails
cross-origin against a loopback-published port, and it duplicates a tool that
is already good. A deep link to
`/dashboard/#/http/routers/<router>@docker` hands the user to Traefik instead.
**No traffic or access metrics:** those come from Traefik's Prometheus
endpoint, which means an exporter and a store, which is a monitoring stack.
`DEV_GATEWAY_ACCESS_LOG=true` plus the existing log viewer is the proportionate
answer when a request needs tracing.

### Writing: three generated files, and nothing else in the directory

`config/traefik/dynamic/` is mounted read-write into the panel. The capability
is real, so it is bounded by name rather than by intention. The panel may write
exactly three paths:

| File | Contents |
|---|---|
| `dev-gateway-panel.yaml` | The BasicAuth middleware guarding the panel's own router ([ADR 0012](0012-panel-authentication-is-traefiks.md)) |
| `dev-gateway-shares.yaml` | The routers, services and middlewares for temporary shares |
| `dev-gateway-aliases.yaml` | One router and service per hostname alias set from the panel |

Any other path is refused in the panel's own process, the way
`apps/web/src/server/docker/allowlist.ts` refuses a Docker call: the check is on the
filename, before anything is written, and `tests/unit/web.test.sh` asserts it.
`middlewares.yaml`, `tcp.yaml`, `local-tls.yaml` and anything a user drops in
by hand are read by Traefik and never touched by the panel. Both generated
files carry a header saying what wrote them.

A **share** is an additional hostname for one service, on
`<service>-<id>.share.<public-domain>`, pointing at a container:

```yaml
http:
  routers:
    share-storefront-web:
      rule: "Host(`storefront-web-a7f3.share.dev.example.com`)"
      entryPoints: [websecure]
      middlewares: [share-storefront-web-auth]
      service: share-storefront-web
  services:
    share-storefront-web:
      loadBalancer:
        servers:
          - url: "http://storefront-web-1:3000"
  middlewares:
    share-storefront-web-auth:
      basicAuth:
        users: ["reviewer:$apr1$..."]
        removeHeader: true
```

The backend is the **container name**, not the Compose service alias: on the
shared network two projects can both alias `web`, and the container name is
unique and already carried as `ContainerSummary.name`.

The project's own router is untouched. A share is an addition, and revoking it
deletes a block from one file, so nothing about the project changes either way.
There are three states per service, and "private" is the absence of a share
rather than a new deny mechanism: `private` (no entry, the default and the only
thing that exists today), `public` (a router, no auth) and `protected` (a
router plus BasicAuth).

Every share carries a mandatory expiry, enforced by the panel and by
`dev-gateway share gc`, which mirrors what `access gc` already does for
bridges. The CLI and the panel manage the same objects, as they do for bridges.

Sharing **refuses** rather than warns, following the precedent
`scripts/cmd/service-publish.sh` set for datastores: never a service whose
`kind` is not `http`, never one that is not already on the shared network,
never `public` unless `PUBLIC_ENABLED` is on and `PUBLIC_DOMAIN` is set, and
never `protected` when TLS is off on a remote profile, because BasicAuth over
plaintext is theatre.

### Amendment: hostname aliases, and why an alias must be a file

A cloned third-party project shows up as whatever it was named, on
`awesome-thing-svc-1.localhost`, and the only way to shorten that is to edit a
`traefik.http.routers.*.rule` label in somebody else's repository — which is
exactly what this gateway promises not to require. So the panel gains a
hostname alias, and it is stored in the gateway's own database.

**A stored alias that did not route would be worse than no feature at all**:
the panel would display an address that answers nothing. The alias therefore
has to reach Traefik, and there are only two ways to do that. A **label** would
be the natural home — [ADR 0005](0005-hostname-convention.md) already derives
hostnames from labels — but Docker has no API to change a label on a running
container, and recreating one means driving Compose, which
[ADR 0001](0001-decoupled-infrastructure.md) forbids and which would restart
someone's environment to change a nickname. That leaves the file provider,
which is already watched, already hot-reloaded, and already the panel's bounded
write surface.

```yaml
http:
  routers:
    dg-alias-storefront-web:
      rule: "Host(`shop.localhost`)"
      entryPoints: [web]
      service: dg-alias-storefront-web
  services:
    dg-alias-storefront-web:
      loadBalancer:
        servers:
          - url: "http://storefront-web-1:3000"
```

Three properties follow from the mechanism and are not negotiable:

- **An alias is additive, never a rename.** The project's own router stays, so
  both hostnames answer. The UI shows the derived hostname beside the alias
  everywhere, and the documentation says so, because a user who expected a
  replacement would otherwise read correct behaviour as a bug.
- **The backend is the container name**, for the same reason a share's is: two
  projects on the shared network can both alias `web`.
- **The target port comes from the project's own
  `traefik.http.services.*.loadbalancer.server.port` label**, falling back to a
  single exposed port. An ambiguous port is refused with the reason rather than
  guessed, because a guessed port produces a router that silently 502s.

Aliasing **refuses** rather than warns, in the same style as sharing, and every
refusal happens before a byte is written: a hostname a container already
derives, a hostname another alias took, a hostname outside
`DEV_GATEWAY_DOMAIN` / `PRIVATE_DOMAIN` / `PUBLIC_DOMAIN`, a non-HTTP service, a
service off the shared network, and anything the YAML quoter would refuse.

The row and the file are written as one operation: the file is rendered whole
from the stored state through the existing atomic temp-file write, and a failed
write rolls the row back, so the database and Traefik cannot disagree about
what answers. The CLI reads the same file, so `dev-gateway urls` lists aliases
marked as such and `doctor` flags one whose target container is gone.

Everything else an override can set — display name, description, primary
service, collapsed services, order, pin, archive, per-service note — is
presentation, stays in the database, and never reaches this directory.

### Hashing: apr1 on `node:crypto`, and no new dependency

Traefik accepts MD5 (apr1), SHA1 and bcrypt in `basicAuth.users`. The panel
image has three runtime dependencies, and that smallness is part of what makes
it safe to run; adding a hashing library, pure-JS or native, is a real cost.

The decisive argument is what is being hashed. The gateway never hashes a
password a person chose: `share` and `web auth` both **generate** one, twenty
characters from a 32-symbol alphabet, which is about a hundred bits. apr1's
thousand MD5 iterations are weak against a guessable password and irrelevant
against a random one, where the entropy, not the work factor, is the boundary.
Someone who insists on their own password writes the hash themselves with
`openssl passwd -apr1` and pastes it, because the gateway stores hashes and
never passwords in the first place.

So: about forty lines of apr1 on `node:crypto` in the panel, and
`openssl passwd -apr1` on the host for the CLI, which needs no Node. The cost
is an implementation we have to keep correct, and the mitigation is a test that
checks our output against `openssl passwd -apr1` with a fixed salt whenever
openssl is on the machine.

## Consequences

The panel can configure Traefik. That is a genuinely new power for a component
that may be reachable over a VPN, and the reason this is an ADR: the bound is
three filenames and three schemas, asserted by the build, and everything else
in the directory stays the user's. Each addition is one more thing the panel
can do to routing, and each one costs an amendment here — which is the check
working rather than an obstacle to route around.

Exposure becomes per service, expires on its own, and leaves the project's own
configuration alone. A password is generated, shown exactly once, and only its
hash is at rest: no API response ever contains it, which is the discipline
`settings.ts` already applies to `TS_AUTHKEY`.

An alias shares the share mechanism's failure modes and its mitigations: it
pins a container name, so an environment recreated under a different namespace
leaves a dangling router, and a diagnostic in the panel and in `doctor` says so.

Three failure modes are real and are handled by diagnostics rather than
prevented. A share can outlive its reason, so expiry is mandatory and expired
shares are listed on the Overview. A share names a container, so recreating
that container under a different namespace breaks it, and a check flags shares
whose target no longer exists. A generated file can be edited by hand, and the
next write overwrites it, which is what the header says.

The Traefik verdict is conditional on the dashboard being enabled, so the UI
gains a state it must render honestly: not "no problem", but "not asked".

Enabling the dashboard already makes `:8080` reachable from every container on
the shared network, because the loopback bind constrains the host and not the
network. That was true before this ADR and is now written down in
[security.md](../security.md) instead of being inherited by accident.
