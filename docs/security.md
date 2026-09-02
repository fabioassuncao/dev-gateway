# Security

## Threat model

The gateway is a development tool. Its job is to make it *hard to expose
something by accident*, and to keep an accident's blast radius small.

The realistic risks are, in order:

1. **Accidental exposure.** A database on `0.0.0.0`, a dashboard on a public
   interface, a "temporary" public domain nobody turned off.
2. **Docker socket access.** The API is not namespaced; reaching it means root
   on the host.
3. **Secret leakage.** Auth keys and API tokens in Git, logs, or shell history.
4. **Lateral movement.** One project's compromise reaching another's database.

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
- The panel's own PostgreSQL is stricter: it publishes no port at all, joins
  only an `internal` data network, and makes `doctor` fail if it appears on the
  shared HTTP network.

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
project. `tests/e2e/parallel.test.sh` asserts that one project cannot reach
another's database.

The shared `portta` network is the one place projects meet, and only
HTTP-facing services join it. Anything on it is reachable by every other
project on the host, which is exactly why a database does not belong there.

## TCP access bridges

A bridge is a hole into a project's private network, so it is kept small and
short-lived. It binds `127.0.0.1` on a kernel-assigned port; binding anywhere
else needs an explicit `--bind` and a confirmation, and `doctor` **fails** on a
bridge bound beyond loopback.

`portta service publish --public` on a datastore is refused outright, not
warned about. Persistent forwarders join their project's network and the
gateway's access network only, never the shared HTTP network, which `doctor`
also enforces.

`access close` and `access gc` re-check the ownership label on the code path
that actually removes a container, rather than trusting the filter that found
it.

## The dashboard

Off by default. When enabled it is published on its own loopback-bound port and
attached only to Traefik's internal entrypoint, so it is never routed through
`web`/`websecure` and cannot appear under a public wildcard domain. `doctor`
fails if it is enabled on a non-loopback address.

The loopback bind constrains the host, not the shared network. Insecure mode
listens inside a namespace attached to `portta`, so while the dashboard is
enabled **any adopted project's container can reach `http://traefik:8080`** and
read the full routing configuration, including the hostnames and backends of
every other project on the host. On the Tailscale attachment the same API
answers at `http://tailscale:8080`. That is the cost of turning it on, it is
why it is off by default, and it is the same API the panel reads for a router's
status ([ADR 0011](adr/0011-panel-reads-traefik-writes-one-file.md)). Nothing
sensitive to a project's own users is there, but the inventory of the host is.

## Databases reached by hostname

Off by default. Turning it on publishes one port per protocol; it does not
publish a database. Three things have to line up before one answers:
`PORTTA_TCP=true` on the gateway, `traefik.enable=true` plus TCP router
labels on the container, and the container on the access network. Being visible
to the gateway is not being routed.

- **Never public.** The TCP entrypoints are refused on the `remote-public`
  profile, where Traefik binds every interface. That is a refusal at profile
  resolution, not a warning, and `doctor` fails if the combination is ever
  reached another way.
- **Where they listen** follows the profile, like everything else: loopback
  locally, the tailnet address with Tailscale, an interface you named
  otherwise.
- **Not on the HTTP network.** An opted-in datastore joins
  `portta-access`. The shared network still carries no database, and
  `tests/unit/templates.test.sh` fails the build if a template puts one there.
- **TLS is mandatory**, since the hostname lives in the handshake. Without a
  configured certificate Traefik serves a self-signed one, which
  `sslmode=require` accepts and `verify-full` does not; `doctor` says so.

Authentication is unchanged and is still the database's own. The gateway routes
bytes and never reads a project's credentials.

## The web panel

Off by default. It is the one component that can start, stop and remove
containers, so it is fenced on three sides.

- **Network.** Loopback by default. VPN routing and the dedicated public panel
  entrypoint are separate, explicit overlays; the public overlay does not
  publish the application's `web`/`websecure` entrypoints.
- **Authentication, once it is routed.** `--expose vpn` and `--expose public`
  require `PORTTA_WEB_AUTH=basic` and a credential, and are refused without one.
  Traefik delegates to the separate, unexposed `portta-auth` process before the
  panel receives a request. Browser logins create host-only signed sessions;
  Basic credentials remain available to non-browser clients. The password is
  generated, shown once, and stored only as a private hash. A routed panel also
  defaults to read-only, and `doctor` fails if either is missing. See
  [authentication.md](authentication.md).
- **Traefik configuration.** The panel may write four filenames in
  `config/traefik/dynamic/` and refuses every other path in its own process.
  See [ADR 0011](adr/0011-panel-reads-traefik-writes-one-file.md).
- **Temporary shares.** A share is one additional hostname for one service,
  with a mandatory expiry, on a network the gateway already answers: it exposes
  a hostname, never a network. Sharing a datastore, a service off the shared
  network, anything public without `PUBLIC_ENABLED`, and a password over
  plaintext on a remote profile are all refused rather than warned about. The
  password is generated, shown once and stored only as a hash. See
  [sharing.md](sharing.md).
- **Docker.** Its own socket proxy, not Traefik's, which stays read-only. It
  grants the read endpoints plus the container lifecycle, and denies images,
  volumes, exec, build, swarm, secrets, plugins and the system endpoints. The
  panel then refuses to emit any call outside its own allowlist, so `prune`,
  `exec`, `archive` and `attach` are denied even where the proxy would forward
  them. See [ADR 0008](adr/0008-web-panel-socket-proxy.md).
- **Blast radius.** A removal always sends `v=0&link=0`: volumes, networks and
  images outlive the container. The only container the panel can create is the
  socat TCP bridge, with a fixed image and no host access at all. Gateway
  components cannot be removed from it.

A mutating request must come from the panel's own origin, so a page on another
site cannot drive it through `127.0.0.1`. `PORTTA_WEB_READ_ONLY=true`
refuses every write, which is the right setting when an agent is driving it.

### Applying settings, and what it costs

`PORTTA_APPLY=true` is the one setting that widens the panel's reach past that
fence, and it is off by default. With it, `portta up` prepares a stopped
container holding the Docker socket, whose command is fixed at creation, and the
panel gains a button that starts it.

Said plainly: **anyone who can write through the panel can then run `portta up`
on this host, in a root container holding the socket** — which is root on the
host. The sharpest edge is `PORTTA_PROFILE`, which the Settings page can already
write: saving `remote-public` and applying puts every opted-in service on the
internet with nobody at a terminal.

What bounds it: it is off unless the operator edits `.env` on the host, and
`PORTTA_APPLY` is deliberately absent from the panel's field catalogue, so the
panel cannot enable itself. It is refused in read-only mode, refused when the
panel is exposed publicly, and refused on the `remote-public` profile. The
applier takes no argument from the panel, has no network, and the panel gains no
new Docker permission for it — `start` was already allowed, and
`tests/unit/audit.test.sh` fails the build if the proxy flags or the allowlist
grow. See [ADR 0026](adr/0026-applying-settings-from-the-panel.md).

Leave it `false` on any host whose panel is reachable by someone you would not
hand a shell.

## Secrets

- `.env` is git-ignored; `bootstrap` creates it `0600`; `doctor` warns if it
  becomes group- or world-readable.
- `portta inspect` prints `<set>` / `<unset>`, never values.
- Gateway state, including ACME material, lives under `state/`, which is
  git-ignored. `acme.json` is kept `0600` and `doctor` fails if it is not.
- Lint fails the build on tracked Tailscale auth keys or PEM private keys.
- The gateway never reads a consumer project's `.env` to "helpfully" print
  credentials. Connection strings it shows are templates with the secret
  omitted.
- The web panel's API never returns a secret value, in whole or in part. It
  reports whether one is set, and writing `.env` goes through a temporary file
  with mode `0600`.
- Panel database clients run in the ephemeral toolbox on the private data
  network. Docker inherits `PGPASSWORD`; the credential is never interpolated
  into a connection URL or command argument. Dumps contain database objects,
  not the `.env` credential.

For Cloudflare, use a scoped API Token limited to `Zone:DNS:Edit` on one zone.
Never the Global API Key: it authenticates everything in the account and cannot
be scoped or usefully rotated.

For Tailscale, prefer an ephemeral, tagged, pre-authorized auth key so a leaked
key ages out on its own.

## Header aliasing

A header named `X_Auth_User` becomes `X-Auth-User` once CGI, WSGI, PHP or nginx
normalises it, which lets a client forge a header Traefik believes it controls.
`PORTTA_ALIAS_HEADERS_STRATEGY` selects `keep` (Traefik's default, fine
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
- **Project authorization and multi-user identity.** A project can opt one
  router into Portta's single-credential ForwardAuth with
  `portta-forward-auth@file`; Portta does not add roles, accounts or edit that
  project's labels. Use the VPN or a full IdP when that is the boundary needed.
- **Multi-tenancy.** Every project on a host shares one Traefik and one shared
  network. This is a single-developer or single-team tool.
- **Container escape.** The gateway reduces Docker API exposure; it does not
  harden the runtime itself.

## Reporting

Found something? Open a private security advisory on the repository rather than
a public issue.

## Outbound network access

Until the GitHub App existed, the panel made exactly one outbound request, to
Traefik's API on an internal address. With `GITHUB_APP_ENABLED=true` it also
talks to `api.github.com` (or your Enterprise Server root).

This is worth saying plainly on a VPS: **a panel that may be routed over a VPN
now reaches the internet.** It does so on the `gateway` network it is already
attached to; `webcontrol` and `webdata` stay `internal: true`, so neither the
Docker socket proxy nor the database gains a route out.

The panel holds one long-lived secret for this — the App's private key — and it
holds it as a **file it cannot write**: `state/github/app.pem`, mounted
read-only at mode 600, passed by path rather than as a `.env` value precisely
because the panel can write `.env`. `portta doctor` fails, rather than
warns, on a key that is missing, unreadable, or readable by more than its
owner.

Installation tokens live for an hour in memory and are never persisted. No
token, key or webhook secret appears in any API response, and tests assert it.

With the integration off — the default — none of the above applies: the panel
makes no request to github.com at all. See [github.md](github.md).
