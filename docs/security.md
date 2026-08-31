# Security

## Threat model

The gateway is a development tool. Its job is to make it *hard to expose
something by accident*, and to keep an accident's blast radius small.

The realistic risks are, in order:

1. **Accidental exposure** — a database on `0.0.0.0`, a dashboard on a public
   interface, a "temporary" public domain nobody turned off.
2. **Docker socket access** — the API is not namespaced; reaching it means root
   on the host.
3. **Secret leakage** — auth keys and API tokens in Git, logs, or shell history.
4. **Lateral movement** — one project's compromise reaching another's database.

## Nothing is exposed by default

- `providers.docker.exposedByDefault=false`. A service is routed only when it
  sets `traefik.enable=true`.
- The local profile binds Traefik to `127.0.0.1`. `doctor` **fails** if the
  local profile is bound anywhere else.
- The public profile is off, and turning it on prints what will become
  reachable and asks for confirmation.
- Databases and caches are never published and never joined to the shared
  network. `doctor` fails on a datastore published on `0.0.0.0` and warns on
  one attached to the shared network.

## The Docker socket

Traefik never sees it. Discovery goes through
`tecnativa/docker-socket-proxy`, which mounts the socket **read-only** and
allows only `CONTAINERS`, `NETWORKS`, `EVENTS`, `PING` and `VERSION`. All
writes are denied (`POST=0`). The proxy runs `read_only: true`, publishes no
host port, and lives alone with Traefik on a network created `internal: true`.

`doctor` fails if the socket is mounted into Traefik, if the proxy's mount is
writable, if the proxy publishes a host port, or if the control network is not
internal.

**Residual risk, stated plainly.** Discovery requires
`GET /containers/{id}/json`, whose response includes container environment
variables. A compromised Traefik could therefore read secrets that consumer
projects pass as environment variables. This is inherent to Traefik's Docker
provider, not to this proxy. If that matters for a given project, pass secrets
as files or via a secrets manager rather than env vars.

See [ADR 0002](adr/0002-docker-socket-proxy.md).

## Network isolation

Each project keeps its own private network. Postgres, Redis, queues and search
stay there. Traefik has no route to those networks, and neither does any other
project — `tests/e2e/parallel.test.sh` asserts that one project cannot reach
another's database.

The shared `dev-gateway` network is the one place projects meet, and only
HTTP-facing services join it. Anything on it is reachable by every other
project on the host, which is exactly why a database does not belong there.

## The dashboard

Off by default. When enabled it is published on its own loopback-bound port and
attached only to Traefik's internal entrypoint, so it is never routed through
`web`/`websecure` and cannot appear under a public wildcard domain. `doctor`
fails if it is enabled on a non-loopback address.

## Secrets

- `.env` is git-ignored; `bootstrap` creates it `0600`; `doctor` warns if it
  becomes group- or world-readable.
- `dev-gateway inspect` prints `<set>` / `<unset>`, never values.
- Gateway state, including ACME material, lives under `state/`, which is
  git-ignored. `acme.json` is kept `0600` and `doctor` fails if it is not.
- Lint fails the build on tracked Tailscale auth keys or PEM private keys.
- The gateway never reads a consumer project's `.env` to "helpfully" print
  credentials. Connection strings it shows are templates with the secret
  omitted.

For Cloudflare, use a scoped API Token limited to `Zone:DNS:Edit` on one zone.
Never the Global API Key: it authenticates everything in the account and cannot
be scoped or usefully rotated.

For Tailscale, prefer an ephemeral, tagged, pre-authorized auth key so a leaked
key ages out on its own.

## Header aliasing

A header named `X_Auth_User` becomes `X-Auth-User` once CGI, WSGI, PHP or nginx
normalises it — which lets a client forge a header Traefik believes it controls.
`DEV_GATEWAY_ALIAS_HEADERS_STRATEGY` selects `keep` (Traefik's default, fine
behind loopback), `delete` or `reject`. The public profile raises it to
`delete`.

## Shell safety

The CLI runs `set -euo pipefail`, parses `.env` rather than sourcing it (a
backtick in a value cannot execute), quotes expansions, and uses no `eval` on
user-supplied data. Project names and service names coming from Docker labels
are normalised before being interpolated anywhere.

## What is not protected

- **Firewall.** Docker's published ports bypass UFW, so the bind address is
  the boundary the gateway actually relies on. See
  [firewall.md](firewall.md).
- **Authentication.** There is no built-in identity layer. Anything routed is
  reachable by anyone who can reach the gateway. Use the VPN profile for
  anything that matters.
- **Multi-tenancy.** Every project on a host shares one Traefik and one shared
  network. This is a single-developer or single-team tool.
- **Container escape.** The gateway reduces Docker API exposure; it does not
  harden the runtime itself.

## Reporting

Found something? Open a private security advisory on the repository rather than
a public issue.
