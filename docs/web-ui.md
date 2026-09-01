# The web panel

A small administration panel for the gateway: what is routed, what is running,
where to reach it, and what is in the way. It complements the CLI rather than
replacing it, and both read the same Docker labels, so they can never disagree.

It is off by default.

```bash
./bin/dev-gateway web up
./bin/dev-gateway web open      # http://127.0.0.1:8081
```

![The Overview page: counts for projects, services, routed URLs and containers, the problems the panel detected, the gateway's own configuration, and the available URLs](../.github/images/panel-overview.png)

Every screenshot on this page comes from the same host, described in
`web/e2e/demo-host.mjs` and rendered by the real panel. Regenerate them with
`npm run screenshots` (see [Development](#development-with-hot-reloading)).

---

## What it is for

Switching between several environments in a day is mostly a lookup problem:
which URL does this project have today, which port is that other stack already
holding, is the container I forgot last week still running, and how do I point
a GUI client at this project's database without publishing 5432.

The panel answers those, and offers the few operations that go with them:
restart, stop, start, remove, read logs, open and close a TCP bridge.

It is not a Docker management tool. There is no image management, no volume
management, no `docker compose` editor, no terminal, no prune, and no way to
create an arbitrary container. See [Out of scope](#out-of-scope).

---

## Architecture

```text
Browser
   |                              http, loopback by default
Panel (Hono + React, one container)
   |                              filtered Docker API, internal network
Panel socket proxy
   |                              read-only bind of the socket
Docker
```

The panel is a single container. In production the Node process serves both the
JSON API and the built UI, so there is one address to remember. It joins two
networks: the gateway's shared network (so it can be published, and routed by
Traefik when that is asked for) and its own `internal` control network, where
its socket proxy lives.

It never sees the Docker socket, has no Docker CLI, and reads exactly two
paths from the host: `.env`, which its Settings page edits, and `VERSION`.

Why a second socket proxy rather than Traefik's: Traefik's is read-only and
must stay that way, while the panel needs the container lifecycle. The two
permission sets are kept apart, and the panel enforces its own allowlist on top
of the proxy's. See [ADR 0008](adr/0008-web-panel-socket-proxy.md).

### Technologies

| Layer | Choice |
|---|---|
| API | Node 24, TypeScript, [Hono](https://hono.dev/), Zod for input validation |
| UI | React 19, Vite 8, Tailwind CSS 4, Radix primitives, TanStack Query |
| Live updates | Server-sent events, fed by Docker's own event stream |
| Tests | Vitest (API, core, components), Playwright (end to end) |

There is no database. Everything on screen (projects, services, URLs, networks,
ports, health, bridges) is read from Docker at request time, so a container
that disappears simply stops appearing. The only persistent state is the
gateway's own `.env`, which already existed.

---

## Starting it

```bash
./bin/dev-gateway web up          # build if needed, then start
./bin/dev-gateway web open        # print the URL, and open a browser
./bin/dev-gateway web status      # where it listens, and whether it is healthy
./bin/dev-gateway web logs        # follow it
./bin/dev-gateway web restart
./bin/dev-gateway web down        # stop it; the gateway keeps running
./bin/dev-gateway web disable     # stop it and take it out of `dev-gateway up`
```

`web up` writes `DEV_GATEWAY_WEB=true` to `.env`, so from then on
`dev-gateway up` brings the panel along with the rest of the gateway.
`web disable` undoes that.

The host needs Docker, Git and a shell, the same as the gateway itself.
**Node is not required on the host**: the image builds the UI and the server.

### Development, with hot reloading

```bash
./bin/dev-gateway web dev
```

Two containers from the same image: the API with `node --watch`, and Vite in
front of it with HMR on `http://127.0.0.1:5173`. Only `web/src` is
bind-mounted, so the image's `node_modules` stay in place. Edits under
`web/src` reload on their own.

`./bin/dev-gateway web up` goes back to the built image.

If you do have Node on the host and prefer to work outside containers:

```bash
cd web
npm ci
npm run dev        # API on :8081, expects a socket proxy at DG_WEB_DOCKER_API
npm run dev:ui     # Vite on :5173, proxies /api to :8081
npm test           # Vitest: API, core and component suites
npm run test:e2e   # Playwright, against a fake Docker API (no daemon needed)
```

### Regenerating the screenshots

The images on this page and in the README are produced by the real panel, run
against a fixed host described in `web/e2e/demo-host.mjs`:

```bash
cd web
npm run screenshots        # builds, boots the panel, writes .github/images/
```

They are generated rather than taken by hand so they stay in step with the UI,
show the same thing every time, and never contain whatever happened to be
running on the machine that produced them. Change the host in `demo-host.mjs`
and the framing in `e2e/screenshots.mjs`.

---

## Reaching it

### Local

`http://127.0.0.1:8081`, and nothing else. The port is published on
`DEV_GATEWAY_WEB_BIND_ADDRESS`, which is `127.0.0.1` and should stay that way.

Change the port if 8081 is taken:

```bash
./bin/dev-gateway web up --port 8099
```

### Over the VPN

On a VPS, the panel is useful precisely when you are not sitting at the VPS.
The private profile routes it through Traefik, which on that profile listens on
the tailnet and nowhere else:

```bash
./bin/dev-gateway web up --expose vpn
# https://dev-gateway-web.vpn.example.com
```

This adds a Traefik router for `DEV_GATEWAY_WEB_HOST.<domain>` and nothing
more. It is refused on the `remote-public` profile, where Traefik binds every
interface and a router would therefore be public.

### Never on the internet

The panel has no authentication, by design for this version. It is a
development tool, and the correct boundary for it is the network, not a login
form.

```bash
./bin/dev-gateway web up --expose public
# error: the panel is never published on the internet
```

If you are on a plain VPS without a VPN, an SSH tunnel is the answer:

```bash
ssh -N -L 8081:127.0.0.1:8081 deploy@vps
# then open http://127.0.0.1:8081 locally
```

### Read-only mode

```bash
./bin/dev-gateway web up --read-only
```

Every mutating endpoint answers `403`. Useful when an agent is driving the
panel and you want it to be able to look but not touch.

---

## What you see

### Overview

Whether the gateway is up, how many projects and services are running, how many
are healthy, which URLs exist, whether Tailscale and public access are on, how
many containers are on the host, and how many of them the gateway knows
nothing about. Plus anything the panel detected as a problem.

The tiles are the questions people actually ask on a busy host, and the
problems card is the panel saying what it noticed rather than waiting to be
asked: see the [Overview screenshot above](#the-web-panel).

### Projects

Compose projects with **at least one** service on the gateway, grouped by
`COMPOSE_PROJECT_NAME`:

```text
base-empresarial
├── web        routed   http://base-empresarial-web.localhost
├── api        routed   http://base-empresarial-api.localhost
├── postgres   tcp      5432
└── redis      tcp      6379
```

A project's database belongs to the project even though it never joins the
shared network. The worktree is shown when the Compose working directory
disagrees with the project name, which is what
[`dev-gateway namespace`](monorepos.md) produces.

![The Projects page: checkout with an unhealthy worker, storefront with four healthy services, and a second worktree of storefront running beside it, each with its own URLs](../.github/images/panel-projects.png)

### Services

Every service of every integrated project as a flat, filterable list: image,
type, status, health, container port, and the addresses it answers on, split
into **Local**, **VPN** and **Public**. Every address has a copy button.

Addresses come from the same Docker labels Traefik routes on, so what the panel
prints is what Traefik serves. An explicit ``Host(`...`)`` label wins over the
derived hostname, exactly as it does inside Traefik.

![The Services page: every service of every integrated project in one filterable table, with its type, health, container port and the address it answers on](../.github/images/panel-services.png)

### Docker

Every container on the host, in four clearly separated sections:

| Section | What it means |
|---|---|
| **Dev Gateway** | The gateway's own infrastructure. Managed by the CLI, not from here |
| **Integrated projects** | Compose projects connected to the gateway |
| **External Docker** | Compose projects the gateway does not manage |
| **Standalone containers** | Started by hand, outside any Compose project |

They are never mixed into one list. An external container is shown for
diagnosis, not because the gateway has any opinion about it: no URLs, no DNS,
no bridges, no gateway actions. Just what it is, what it holds, and the few
operations below.

![The top of the Docker page: counts by section, and the Dev Gateway section listing the gateway's own containers](../.github/images/panel-docker.png)

Below the sections, a host summary: engine and resources, container counts by
section, networks, and every published port with the container holding it.
Ports claimed by two containers are flagged, which is usually the answer to
"why will this not start".

![Further down the Docker page: External Docker, Standalone containers, and the published ports table flagging 5432 as claimed by two containers at once](../.github/images/panel-docker-external.png)

Filters: All / Dev Gateway / Integrated / External / Standalone, crossed with
Any state / Running / Stopped / Unhealthy, plus a search over container name,
image, project, service and hostname.

### Network

Domains (local, VPN, public), TLS mode and ACME contact, Tailscale state, the
DNS provider, every routed hostname with its target port, and the Docker
networks with their role: shared, control, access, or a project's own.

![The Network page: domains and TLS, the VPN and DNS settings, every routed hostname, and the Docker networks with their roles](../.github/images/panel-network.png)

### Access

Databases, caches and anything else that speaks TCP rather than HTTP.

```text
PostgreSQL    base-empresarial/postgres     [ Open local access ]
```

and afterwards:

```text
127.0.0.1:55431      copy host   copy port   copy connection string   close
```

The bridge is the same one [`dev-gateway access open`](tcp-access.md) creates,
with byte-identical labels, so `dev-gateway access list`, `close` and `gc`
manage it too and neither tool is surprised by the other's work. It binds
`127.0.0.1` on a port the kernel picks, so any number of databases can be
reachable at once without one of them having to give up 5432.

The connection string is a template. It never contains a password: the gateway
does not read a project's `.env` to be helpful.

![The Access page: an open bridge to storefront/postgres on 127.0.0.1:55431 with its connection string, and the other TCP services each with an Open local access button](../.github/images/panel-access.png)

This page also lists persistent forwarders created with
[`dev-gateway service publish --private`](tailscale-services.md).

### Gateway

Component states, versions, the profile, diagnostics, and logs for Traefik, the
socket proxy and Tailscale.

**Diagnostics are not `dev-gateway doctor`.** They are the checks a container
can make honestly: components present and healthy, the shared network, services
that opted into Traefik but never joined it, hostname collisions, port
conflicts, stale bridges, unhealthy containers, and configuration that would
refuse to start. `doctor` runs on the host and additionally sees `PATH`,
listening sockets, DNS resolution and certificate files, which this process
cannot see truthfully. The panel says so and points at the command.

![The Gateway page: component states, versions and profile, the diagnostics it just ran, and Traefik's recent log lines](../.github/images/panel-gateway.png)

### Settings

The settings people actually change, from a fixed catalogue: domains, ports,
bind address, profile, TLS and ACME, Tailscale, public access, DNS provider,
and the panel's own options. A key that is not in the catalogue cannot be read
or written through the API, whatever a request asks for.

![The Settings page: the gateway's .env grouped by topic, each field with the key it writes and what it means](../.github/images/panel-settings.png)

### Light and dark

The panel follows the system theme and remembers an explicit choice. The same
Overview, in the dark theme:

![The Overview page in the dark theme](../.github/images/panel-overview-dark.png)

---

## Actions

| Target | Available |
|---|---|
| Integrated service | logs, start, stop, restart, details, remove (with confirmation) |
| External container | logs, start, stop, restart, details, remove (with confirmation) |
| Project | restart its running services, open its URLs, see its services |
| TCP service | open a loopback bridge, close it, copy host / port / connection string |
| Gateway | status, diagnostics, logs, restart components |

Never offered: recreating a Compose project, editing configuration or
environment variables of a container, changing its networks or volumes, running
an arbitrary command, `docker compose down -v`, resetting a database, mass
removal, or any kind of prune.

### Removing a container

The only destructive action, and it always asks first. The confirmation names
the container and its image, says whether it belongs to the gateway or is
external, and lists its named volumes and bind mounts.

What a removal does **not** do:

- it does not remove a volume, named or anonymous (the call is always
  `v=0&link=0`);
- it does not remove a network;
- it does not remove an image;
- it does not touch a sibling in the same Compose project;
- it never runs a prune.

Gateway components cannot be removed from the panel at all. Access bridges are
closed from the Access page, which removes them cleanly.

### Restarting the gateway

`Restart Traefik` restarts the container in place. Traefik reads its static
configuration from the environment it was created with
([ADR 0003](adr/0003-traefik-static-config-via-env.md)), so a settings change
needs the containers recreated, on the host:

```bash
./bin/dev-gateway up local
```

The panel says this rather than pretending a restart was enough. Saved settings
that the running gateway has not picked up are marked `pending restart`.

---

## Configuration

All of these live in `.env`; `dev-gateway web up` sets the first ones for you.

| Key | Default | Meaning |
|---|---|---|
| `DEV_GATEWAY_WEB` | `false` | Whether the panel starts with the gateway |
| `DEV_GATEWAY_WEB_BIND_ADDRESS` | `127.0.0.1` | Interface the panel is published on |
| `DEV_GATEWAY_WEB_PORT` | `8081` | Host port |
| `DEV_GATEWAY_WEB_EXPOSE` | `local` | `local`, or `vpn` to add a Traefik router |
| `DEV_GATEWAY_WEB_HOST` | `dev-gateway-web` | Hostname label used by `--expose vpn` |
| `DEV_GATEWAY_WEB_READ_ONLY` | `false` | Refuse every mutating endpoint |
| `DEV_GATEWAY_WEB_DEV` | `false` | Development mode, with Vite in front |
| `DEV_GATEWAY_WEB_DEV_PORT` | `5173` | Vite's port in development mode |
| `DEV_GATEWAY_WEB_NETWORK` | `dev-gateway-web` | The panel's internal control network |
| `DEV_GATEWAY_WEB_USER` | `node` | User the container runs as, see below |

On a Linux host, the container's `node` user does not own your `.env`, so the
Settings page cannot save. Set:

```bash
DEV_GATEWAY_WEB_USER=1000:1000     # $(id -u):$(id -g)
```

On macOS the default is fine. Either way the panel reports whether the file is
writable and says to edit it on the host when it is not.

---

## Security

The panel is the one component that can start, stop and remove containers, so
what it cannot do matters more than what it can.

**Network.** Loopback by default, never routed through the public entrypoints,
and `--expose public` is refused outright. Routing it over the VPN is a
separate, explicit overlay, and is refused on the public profile.

**Docker.** Its socket proxy grants the read endpoints plus the container
lifecycle, and denies images, volumes, exec, build, swarm, secrets, plugins and
the system endpoints. On top of that the panel refuses to emit any request that
is not on its own allowlist, so `prune`, `exec`, `archive` and `attach` are
denied even where the proxy would forward them. See
[ADR 0008](adr/0008-web-panel-socket-proxy.md).

**Container creation.** One shape only: the socat TCP bridge, with a fixed
image, fixed labels, no binds, no mounts, no capabilities and no privileged
mode. There is no generic create endpoint.

**Secrets.** `TS_AUTHKEY` and `CF_DNS_API_TOKEN` are never returned by the API,
in whole or in part. The panel reports only whether they are set. Sending an
empty string leaves a secret unchanged; clearing one is explicit. `.env` is
written through a temporary file with mode `600`.

**Writes from another site.** A page on another origin can point a request at
`127.0.0.1`. Reads behind loopback are harmless enough; writes are not, so a
mutating request must come from the panel's own origin (or `localhost`).

**Input.** Every request body is validated with a schema before anything acts
on it. Container ids are checked against Docker's own shape. No shell command
is ever built from a value the UI supplied, because the panel runs no shell
commands at all.

`tests/unit/web.test.sh` asserts each of these as an invariant, so loosening one
fails the build. The wider threat model is in [security.md](security.md).

---

## Troubleshooting

**The panel does not come up.**

```bash
./bin/dev-gateway web status
./bin/dev-gateway web logs
```

**"cannot reach the Docker socket proxy".** The panel's proxy is not running or
not healthy:

```bash
./bin/dev-gateway web logs web-socket-proxy
./bin/dev-gateway web restart
```

**Everything is empty, and the Overview says the Docker API is unreachable.**
The proxy is up but denying calls. Confirm the panel is talking to its own
proxy (`DG_WEB_DOCKER_API`), not Traefik's read-only one, which denies every
write.

**"Open local access" says the bridge image is not on this host.** The panel
cannot pull images, deliberately. Pull it once on the host:

```bash
docker pull alpine/socat:1.8.1.3
```

`dev-gateway web up` does this for you; this happens when the panel was started
some other way.

**Settings will not save.** The panel reports the file as not writable. On
Linux, set `DEV_GATEWAY_WEB_USER` as above, or edit `.env` on the host.

**A saved setting has no effect.** Traefik reads its static configuration at
startup. Run `./bin/dev-gateway up <profile>` on the host; the panel shows the
exact command.

**The live indicator says `offline`.** The event stream dropped. The panel
reconnects on its own, with backoff; a reload also does it. Everything else
keeps working, it just stops updating by itself.

**Port 8081 is taken.** `./bin/dev-gateway web up --port 8099`. The Docker page
shows which container is holding it.

**A container I removed came back.** It belonged to a Compose project, and
something ran `docker compose up` in that project's directory. The panel warns
about this in the confirmation.

---

## Out of scope

Not implemented, and not planned for this version: authentication, users, RBAC,
historical metrics, monitoring, Kubernetes, deployments, a Compose editor, a
web terminal, image management, volume management, network management,
arbitrary container creation, or being a replacement for Portainer or Docker
Desktop.

The panel exists to make the gateway pleasant to use day to day, for people and
for agents, and to stop there.
