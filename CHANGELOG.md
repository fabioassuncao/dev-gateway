# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the version is `0.x`, minor releases may contain breaking changes.

## [Unreleased]

### Added

- **A decided monorepo and a decided answer on Node.** [ADR 0014](docs/adr/0014-monorepo-and-the-typescript-cli.md)
  records the workspace layout (`apps/web`, `packages/core`, `packages/cli`),
  the CLI / API / Core rule, the npm name `@fabioassuncao/dev-gateway`, and the
  file-by-file Bash migration map. [ADR 0015](docs/adr/0015-node-on-the-host.md)
  keeps `bootstrap`, `up`, `down`, `status` and `doctor` working without Node.
  [docs/monorepo.md](docs/monorepo.md) is the contributor map. No package is
  created yet; issue #8 performs the move.



- **Private, degradable persistence for the panel.** A pinned PostgreSQL 18
  container now stores only durable decisions and identity on its own internal
  network and named volume; it publishes no host port and never joins the
  shared HTTP network. Ordered transactional migrations establish the stable
  instance, portable project coordinates, typed settings and integrations,
  while Docker, Git and Traefik remain the sources of runtime observations.
  The panel still starts and all existing Docker-backed routes remain healthy
  when PostgreSQL is down, with an explicit diagnostic warning. `doctor`
  enforces the isolation, and `dev-gateway db status|shell|dump|restore`
  provides password-safe operations through the toolbox, including a
  confirmation-gated restorable custom-format backup.

- **A discoverable API contract for people and agents.** The panel now serves
  an OpenAPI 3.1 document at `/api/openapi.json`, generated from the registered
  Hono routes and the same Zod schemas that define the TypeScript contracts.
  Every endpoint carries parameters, request bodies, response and error
  schemas, status codes, read-only and cross-origin refusals, and the SSE event
  payload. `web/openapi.json` is checked in and CI fails on byte-level drift.
  `/api/docs` is a self-contained interactive browser with no external assets;
  it defaults on for loopback and off for a routed panel unless
  `DG_WEB_API_DOCS=true` explicitly enables it.

- **The panel has a front door, and it is Traefik's.** `--expose vpn` used to
  put start, stop, restart and remove over every container on the host behind
  nothing but the tailnet. It now requires a credential and is refused without
  one.
  - `dev-gateway web auth set` generates a password (twenty characters over a
    thirty-two symbol alphabet, so about a hundred bits), shows it exactly once,
    and stores only its apr1 hash. Nothing puts it on a command line, where `ps`
    would show it to every user on the host. `--password-stdin` supplies your
    own; `web auth`, `web auth apply` and `web auth clear` do the rest.
  - `DEV_GATEWAY_WEB_AUTH`, `_USER` and `_HASH` join the settings catalogue,
    with the hash marked secret so the API reports it as set and never returns
    it. The field refuses anything that is not a hash, which is what stops a
    plaintext password reaching Traefik because somebody filled in the wrong
    box.
  - None of it lives in the panel: no login form, no session, no cookie, no user
    store, and no route handler a bug could let past. The middleware is rendered
    into `config/traefik/dynamic/dev-gateway-panel.yaml` and referenced by the
    router in `compose.web-vpn.yaml`. A middleware Traefik cannot resolve makes
    the router fail closed. The trade is one credential for the whole panel,
    with no users and no roles ([ADR 0012](docs/adr/0012-panel-authentication-is-traefiks.md)).
  - A routed panel now defaults to read-only. `--writable` opts out.
  - `dev-gateway doctor` and the panel's own diagnostics **fail**, not warn, on
    a routed panel with no credential, matching the existing precedent for a
    non-loopback dashboard.
- **The panel says what each environment is running.** Each project carries its
  branch, HEAD with the commit subject, how much is uncommitted, and how far it
  has drifted from the remote, with the branch, commit and repository as links
  derived from the remote by string work alone.
  - `dev-gateway git scan` collects it on the host, where `git` already is and
    where the Compose labels already say which directory belongs to which
    project, and writes `state/git/<project>.json` (mode `600`) into a
    directory the panel mounts **read-only**. The panel gains no new access at
    all: no project directory is mounted into it, `EXEC` stays off, and it
    still runs no shell commands
    ([ADR 0010](docs/adr/0010-git-collected-on-the-host.md)).
  - Nothing polls. The card always says how old the scan is, marks anything
    past the threshold as stale, and shows the exact host command to refresh
    it. `dev-gateway up` and `dev-gateway web up` run one for you.
  - Read-only in both directions: no checkout, merge, rebase, fetch or push, no
    diffs, no file contents, and nothing beyond HEAD.
  - A project with no Git gets no card; a repository with no remote keeps its
    branch and loses the links; a forge nobody recognises keeps the repository
    link and loses the commit one; a project nobody scanned shows the command.
    All four are tested.
  - `dev-gateway git status` says what was collected and when, and
    `dev-gateway git clear` removes it.
- **Open pull requests, through `gh`.** `git scan --with-prs` adds each
  project's open pull requests with their review decision and whether checks
  pass. It reuses the authentication `gh` already has, so there is no token in
  `.env`, nothing for a routed panel to leak, and no rate limit of ours to
  account for. Opt-in because it is a network call per project, and cached for
  `--forge-ttl` seconds. No `gh`, a signed-out `gh` and a forge `gh` cannot talk
  to all render nothing rather than an error, and the repository link survives
  all three because it is derived from the remote.
- **Sharing one service, temporarily, with one person.** The choices used to be
  "not routed", "routed on the VPN so everyone on the tailnet can reach it" and
  "`PUBLIC_ENABLED=true`, so every opted-in service on the host is on the
  internet". None of those is "show this one thing to this one person until
  tomorrow". See [docs/sharing.md](docs/sharing.md).
  - Three states per service, and `private` is the absence of a share rather
    than a new deny mechanism: `protected` is an additional hostname behind a
    generated password, `public` one with none.
  - A share is an **addition**: a router in one generated file, pointing at the
    container by name because two projects on the shared network can both alias
    `web`. The project's own router, labels and configuration are never
    touched, so revoking one deletes a block and changes nothing else.
  - The password is generated, shown exactly once and stored only as a hash. No
    response ever carries it again; regenerating replaces the hash and shows a
    new one.
  - Every share carries a mandatory expiry, between a minute and a week. Active
    shares are counted on the Overview and expired or dangling ones show up in
    the diagnostics, because an exposure nobody remembers is the one worth
    surfacing.
  - Refusals rather than warnings, following the `service publish` precedent: a
    non-HTTP service, a service off the shared network, `public` without
    `PUBLIC_ENABLED` and `PUBLIC_DOMAIN`, and a password over plaintext HTTP on
    a remote profile.
  - `dev-gateway share list | revoke | gc` manages the same objects from the
    host, the way `access` already does for bridges.
- **Traefik's own verdict on a route.** Opening a service shows the router
  Traefik actually built, its rule, entrypoints, middlewares and resolved
  backend, and its status with Traefik's own error text when it refused one.
  That is the question labels cannot answer: the panel derives hostnames the
  same way Traefik does and is right about them, so "the labels look right and
  it still 404s" had nowhere to go.
  - `doctor` gains two checks that use it: a routed service Traefik never built
    a router for, and a router it refused, quoted rather than guessed at.
  - Read-only, over the shared network the panel is already on and never over
    `control`, which would put Traefik's read-only socket proxy within its
    reach. The host is resolved from the attachment, since Traefik has no name
    of its own inside the Tailscale namespace
    ([ADR 0011](docs/adr/0011-panel-reads-traefik-writes-one-file.md)).
  - Its own cache, its own timeout, and never on the path a page render waits
    on. A dead Traefik API costs this block and nothing else.
  - It needs `DEV_GATEWAY_DASHBOARD=true`, which is off by default, and the UI
    then says the API **was not asked** rather than implying the labels were
    confirmed. The dashboard is linked to, never embedded.
- **Three optional labels, for the things inference cannot get right.**
  `dev-gateway.project` groups several worktrees under one heading when
  `COMPOSE_PROJECT_NAME` is a per-worktree namespace; `dev-gateway.repo`
  (`owner/name` or a remote URL) gives repository links with no host-side Git at
  all; `dev-gateway.git.root` says where the repository starts when the Compose
  file is not at its root. A project that sets none behaves exactly as it did
  before they existed, and the test suite asserts that rather than the
  documentation promising it. `dev-gateway analyze` reports which ones a project
  sets ([ADR 0010](docs/adr/0010-git-collected-on-the-host.md)).
- The panel mounts `config/traefik/dynamic/` read-write and may write exactly
  two filenames there, refusing every other path in its own process the way it
  already refuses a Docker call outside its allowlist. Everything else in that
  directory stays yours
  ([ADR 0011](docs/adr/0011-panel-reads-traefik-writes-one-file.md)).
- **A web administration panel, off by default.** `dev-gateway web up` starts a
  small panel on `127.0.0.1:8081` that answers the lookups that come up when
  several environments run at once: which URL a project has today, what is
  holding a port, which containers are still up from last week, and how to
  point a GUI client at a database. It complements the CLI rather than
  replacing it, and both read the same Docker labels, so they cannot disagree.
  See [docs/web-ui.md](docs/web-ui.md).
  - Projects and services grouped by `COMPOSE_PROJECT_NAME`, with their local,
    VPN and public addresses, each one copyable.
  - Every other container on the host, kept in its own section: External
    Docker and Standalone are never mixed into the list of projects the gateway
    manages. Published ports are listed with the container holding them, and a
    port claimed twice is flagged.
  - TCP access: opening and closing a bridge from the browser, creating exactly
    the bridge `dev-gateway access open` creates, labels included, so
    `access list`, `close` and `gc` keep managing it.
  - Logs, start, stop, restart, and a removal that names the container, its
    image and its volumes, and takes the container and nothing else.
  - Diagnostics the panel can make honestly from inside its container, pointing
    at `dev-gateway doctor` for the host-level checks it cannot see.
  - Settings for the common `.env` keys, from a fixed catalogue. Secrets are
    never returned by the API, only reported as set or unset.
  - Live updates over server-sent events, fed by Docker's own event stream. No
    polling.
- `dev-gateway web up | down | disable | restart | status | open | logs | build | dev`.
  `up` waits for the panel to answer before it reports success, so the URL it
  prints is never dead by the time you open it.
- The panel's own Docker socket proxy, so Traefik's stays read-only
  ([ADR 0008](docs/adr/0008-web-panel-socket-proxy.md)). It grants the read
  endpoints plus the container lifecycle and denies images, volumes, exec,
  build, swarm, secrets and the system endpoints; the panel then refuses to
  emit any call that is not on its own allowlist.
- `DEV_GATEWAY_WEB*` settings, all documented in `.env.example`, and the
  `compose.web.yaml`, `compose.web-vpn.yaml` and `compose.web-dev.yaml`
  overlays.
- Screenshots in the README and in `docs/web-ui.md`, generated by the real
  panel against a fixed host (`cd web && npm run screenshots`) rather than
  taken by hand, so they stay in step with the UI and never contain whatever
  happened to be running on the machine that produced them.
  - Each service carries the mark of the technology behind it, resolved from
    the image, then the Compose service name, then the OCI title label, and
    falling back to a generic container mark. It sits next to the name, never
    instead of it, and is decorative: screen readers read the name only.

- **Databases told apart by hostname, on one shared port.** With
  `DEV_GATEWAY_TCP=true` the gateway publishes one entrypoint per protocol and
  picks the backend from the TLS Server Name Indication, so two projects can
  both run PostgreSQL on 5432 inside their own containers and neither has to
  publish a port or renumber anything:

  ```
  base-empresarial-postgres.localhost:5432  ->  base-empresarial's postgres
  base-eleicoes-postgres.localhost:5432     ->  base-eleicoes's postgres
  ```

  Verified with two live instances and distinct data, for PostgreSQL and Redis.
  **MySQL cannot do this**: its protocol has the server send the first packet,
  so there is no hostname to route on before a backend must be chosen, and no
  substitute was invented for it. It keeps the loopback bridge, which still
  works for every protocol. The analysis, the measurements and the exact limits
  are in [docs/tcp-routing.md](docs/tcp-routing.md) and
  [ADR 0009](docs/adr/0009-tcp-routing-by-hostname.md).
  - TLS is terminated at the gateway, so consumer projects need no certificate,
    no `ssl = on` and no renewal. `sslmode=require` is enough.
  - Opted-in datastores join the access network, never the shared HTTP one.
  - Hostnames stay flat, `<project>-<service>.<domain>`, because a wildcard
    certificate covers exactly one label and the gateway already issues one.
  - Refused on the `remote-public` profile: a database is never reachable from
    the internet.
- `templates/overlays/09-tcp-routing.yaml` and
  `examples/demo-a/compose.dev-gateway-tcp.yaml`, so a project opts in by
  copying a file.
- `dev-gateway services` and the panel's Access page show the hostname address
  where a protocol supports it, and say plainly when one does not.
- Four more example stacks, so the shapes the gateway meets are all runnable:
  [`demo-site`](examples/demo-site) (one service), [`demo-shop`](examples/demo-shop)
  (web, API, worker, MySQL, Redis, Mailpit and RustFS),
  [`demo-monorepo`](examples/demo-monorepo), and
  [`demo-external`](examples/demo-external), which never adopts the gateway and
  exists to be seen under External Docker. `demo-a` and `demo-b` stay the CI
  pair. `make demo-up-all` starts every adopted one.
- `templates/overlays/10-mailpit.yaml` and `templates/overlays/11-rustfs.yaml`:
  the UI joins the gateway, SMTP and the S3 API stay on the project network.

### Fixed

- **A share answered 502 while looking perfectly configured.** The backend port
  was taken from the container's exposed ports, but a project that already told
  Traefik which port to use (`loadbalancer.server.port`) usually exposes
  another: a base image's 80 in front of an application on 3000. The label now
  wins, so a share reaches the same backend the project's own router does.
- **One generated file with nothing in it broke every other file in the
  directory.** `http: {}` is not an empty configuration to Traefik, it is an
  invalid one, and `collecting file configs` aborts the whole directory when
  any file in it fails: with no shares and no panel credential, no generated
  router was served at all. Both files now carry comments and no `http` key
  when they have nothing to declare.
- **`dev-gateway web auth set` exited 141 and printed nothing.** Reading
  `/dev/urandom` into `tr` and closing the pipe from `head -c` kills `tr` with
  SIGPIPE, which `set -o pipefail` then reports as a failed command. The input
  is bounded first, so every stage reaches EOF.
- **`dev-gateway urls` ignored every explicit `Host()` label and every
  `loadbalancer.server.port`.** Both were read with a Go template using
  `hasPrefix`, which Docker's `inspect --format` does not have: the template
  failed to parse, printed nothing, and the code fell back to the derived
  hostname and `auto` without a word. `scripts/cmd/clients.sh` had documented
  that exact trap since it was written. Labels are now read out of the template
  and filtered in the shell, and a test fails the build if `hasPrefix` reappears
  in a shipped script.
- **The panel called a hostname-routed database an HTTP service.** Opting a
  datastore into TCP routing also sets `traefik.enable`, and the container's
  kind was read from that label alone, so PostgreSQL was listed as `http`. It
  is now derived from whether the container actually ended up with a URL, the
  same question `urls` and the Access page already ask.
- The TCP routing suite waited for the PostgreSQL routes and then asserted
  against Redis, which has routers of its own that do not necessarily go live
  at the same moment. It passed on a quiet machine and failed on a loaded CI
  runner. Each protocol now waits for its own routes.

### Security

- The panel is never published on the internet: `--expose public` is refused,
  the VPN overlay is refused on the `remote-public` profile, and the default
  bind is loopback. Routing it over the VPN now also requires a credential.
- **Enabling the Traefik dashboard is broader than its published port
  suggests, and this is now documented.** Insecure mode listens inside a
  namespace attached to the shared network, so while the dashboard is on, any
  adopted project's container can `curl http://traefik:8080/api/rawdata` and
  read the routing configuration of every other project on the host. The
  loopback bind constrains the host, not the network. This was already true; it
  is now in [docs/security.md](docs/security.md) rather than inherited by
  accident.
- Mutating requests must come from the panel's own origin, so a page on another
  site cannot drive it through `127.0.0.1`.
- A removal always sends `v=0&link=0`: volumes, networks and images outlive the
  container, and no code path in the panel can prune anything.

## [0.1.1] — 2026-08-31

### Fixed

- **`analyze` aborted halfway through its report on any host without `lsof`.**
  `dg_analyze_port_holder` returned the exit status of its last probe, so
  "nothing holds this port" came back as a failure; under `set -e` that killed
  the assignment and the rest of the report with it. It passed on macOS, where
  `lsof` is always present, and failed on Linux. The helper now always succeeds,
  also understands `ss`, and has a regression test that runs it with an empty
  `PATH`.
- The `*.localhost` resolution check demanded `127.0.0.1`. RFC 6761 requires
  loopback, and systemd-resolved answers `::1`, which is equally correct.
- The audit suite matched its own text, since it contains every forbidden
  pattern as a search string.
- `bootstrap` now tightens `.env` to `0600` when it is looser. The documented
  quick start, `cp .env.example .env`, inherits the umask and immediately
  tripped `doctor`'s own permission check.

### Changed

- CI uses `actions/checkout@v5`; v4 runs on a deprecated Node runtime.

`v0.1.0` is tagged but was never green on Linux. Use `v0.1.1`.

## [0.1.0] — 2026-08-31

First release. Experimental, and the "Not verified" section below is part of
the release notes, not a footnote.

### The gateway

- **Traefik `v3.7.12`** holding 80 and 443 for the whole host, so no project
  needs to publish an HTTP port. Discovery goes through
  `tecnativa/docker-socket-proxy:v0.5.0`, which mounts the Docker socket
  read-only, allows only the five endpoints the provider calls, denies every
  write, publishes no host port, and sits on a network created `internal: true`.
  The socket is never mounted into Traefik.
- **Hostnames derived automatically** from the labels Compose already injects:
  `<compose-project>-<service>.<domain>`. A project opts in without naming
  itself anywhere, and a new worktree gets new hostnames from one environment
  variable.
- **`exposedByDefault=false`**, so a service is routed only when it sets
  `traefik.enable=true`.
- **Three profiles** as composable Compose overlays: `local`,
  `remote-private`, `remote-public`. Exactly one attachment overlay decides how
  Traefik meets the world.

### Parallel environments

- `COMPOSE_PROJECT_NAME` is the whole mechanism. Four environments, two
  worktrees of one project among them, run at once with web on 3000, api on
  8000, Postgres on 5432 and Redis on 6379, and no host port published by any
  of them.
- `dev-gateway namespace` derives a DNS-safe name from the repository and
  branch.
- Stopping or restarting the gateway leaves applications running; starting it
  again rediscovers them.

### Adopting a project

Projects stay in their own repositories and are never moved, cloned or mounted.

- `dev-gateway analyze <path>` gives a read-only report: services and what they
  look like, published host ports and what already holds them, fixed container
  names, published datastores, an implicit namespace.
- `dev-gateway init <path>` writes exactly one new file, shows it and a diff
  first, never edits `compose.yaml`, supports `--dry-run`, keeps a backup.
- Eight overlay templates, and a page to copy into the consumer repository.

### Databases, caches and other TCP services

- `dev-gateway access open` creates a per-session bridge on the project's
  private network, published on `127.0.0.1` on a port the kernel picks. Any number of
  databases are reachable at once without one of them giving up 5432.
- `dev-gateway db psql` and `redis cli` run a client inside the project's own
  network. Nothing published, nothing left behind.
- `dev-gateway remote access open` sets up a loopback bridge on a VPS plus an
  SSH tunnel here, over Tailscale SSH or plain SSH.
- `dev-gateway service publish --private` creates a dedicated forwarder per
  service on the gateway's access network, for a stable tailnet address. Project
  networks are never merged.

### Remote and TLS

- Tailscale container with Traefik in its network namespace, so a VPS publishes
  nothing on its public interface.
- ACME wildcard certificates over DNS-01, with Cloudflare as the reference
  provider behind a scoped token.
- `dev-gateway public enable` prints the domain, interfaces, ports and the
  exact URLs that would become reachable, then asks.
- `dev-gateway tls init` for optional local HTTPS from a local CA.

### Diagnostics

- `doctor` covers runtime, networks, component health, exposure, DNS, TLS, routing,
  hostname and Traefik service-name collisions, uninterpolated `${...}` in
  labels, bridge binds, and forwarder placement. Read-only, with a suggested
  fix per failure, and `--json`.
- `status`, `urls`, `services`, `network status` and `inspect`, all with
  `--json` where it makes sense.

### Security

- Nothing is exposed by default: loopback bind, no dashboard, no datastore ever
  published, `service publish --public` on a datastore refused outright.
- Secrets never reach the process list: the Cloudflare token goes to curl on
  stdin, database passwords are inherited by Docker rather than interpolated
  into `-e`.
- `.env` is created `0600`; `bootstrap` tightens it if it is looser.
- Every path that removes a container checks `dev-gateway.managed=true` first.
  Nothing prunes, and no volume or network is ever removed.
- SSH host key verification is never disabled.

### Tests

326 checks: lint, documentation-link and audit invariants; unit tests for the
shell library, profiles, templates and the CLI surface; end-to-end suites for
parallel environments, lifecycle independence, adopting an unknown project,
local HTTPS, and TCP access to four simultaneous databases.

The audit suite is the interesting one: it turns the promises above into
regression tests: no absolute home paths, no consumer project named in the
code, no prune of any kind, every container removal ownership-checked, no
secret in argv, nothing exposed by default, every image pinned.

### Not verified

Stated plainly, because the alternative is a claim we cannot back:

- **The tailnet and ACME paths.** They need a real tailnet, a real DNS zone and
  a real ACME account. Configuration tests assert that every profile renders
  and that `remote-private` never binds `0.0.0.0`; the rest is a manual
  checklist in `docs/remote-development.md`.
- **Tailscale Services.** The forwarder half is tested. The Service
  advertisement and grants are printed for you to apply and are not exercised
  here.
- **macOS + Docker Desktop, Debian, Linux arm64, Windows/WSL2.** Expected to
  work, not verified. See `docs/compatibility.md`.
- **UDP.** Not supported, and listed as absent rather than as a caveat.

### Known limitations

- No authentication layer. Anything routed is reachable by anyone who can reach
  the gateway; an optional basic-auth and `forwardAuth` middleware ships
  disabled.
- Single-tenant. Every project on a host shares one Traefik and one shared
  network.
- A compromised Traefik could still read container environment variables
  through `/containers/{id}/json`, which discovery requires. Inherent to
  Traefik's Docker provider; see ADR 0002.
