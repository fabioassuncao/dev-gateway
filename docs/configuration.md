# Configuration

Everything lives in `.env` at the repository root, copied from
`.env.example`. It is git-ignored and may hold secrets, so `bootstrap` creates
it `chmod 600` and `doctor` warns if it becomes group- or world-readable.

Precedence follows Compose: **shell environment > `.env` > built-in defaults**.
Every value has a default, so an empty `.env` still yields a working local
gateway.

```bash
portta inspect     # what the CLI actually resolved (secrets shown as <set>)
```

## Common

| Variable | Default | Meaning |
|---|---|---|
| `PORTTA_PROFILE` | `local` | Default profile for `up` |
| `PORTTA_PROJECT_NAME` | `portta` | Compose project name of the gateway itself |
| `PORTTA_NETWORK` | `portta` | Shared external network |
| `PORTTA_CONTROL_NETWORK` | `portta-control` | Internal Traefik ↔ socket proxy network |
| `PORTTA_ACCESS_NETWORK` | `portta-access` | Network for persistent TCP forwarders |
| `PORTTA_LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `PORTTA_ACCESS_LOG` | `false` | Traefik access logs, useful when a route misbehaves |

`PORTTA_PROJECT_NAME` is load-bearing: ownership checks use it to tell
gateway containers from everything else. Changing it orphans the running stack.

## Local profile

| Variable | Default | Meaning |
|---|---|---|
| `PORTTA_DOMAIN` | `localhost` | Base domain for generated hostnames |
| `PORTTA_BIND_ADDRESS` | `127.0.0.1` | Host interface Traefik publishes on |
| `PORTTA_HTTP_PORT` | `80` | Host port for HTTP |
| `PORTTA_HTTPS_PORT` | `443` | Host port for HTTPS |

`PORTTA_BIND_ADDRESS` is the single most security-relevant setting here.
Loopback keeps the gateway invisible to everyone else on your network;
`doctor` fails if the local profile is bound to anything else.

If 80 is already taken, changing `PORTTA_HTTP_PORT` to, say, `8080` means
URLs become `http://demo-a-web.localhost:8080`.

## Header aliasing

| Variable | Default | Meaning |
|---|---|---|
| `PORTTA_ALIAS_HEADERS_STRATEGY` | `keep` | `keep`, `delete` or `reject` |

Headers whose names contain characters outside `[A-Za-z0-9-]` can alias a
canonical header once a backend normalises them (`X_Auth_User` becoming
`X-Auth-User` in CGI, WSGI, PHP or nginx), which lets a client spoof headers
Traefik manages.

`keep` is Traefik's default and is fine behind loopback or a VPN. `delete`
strips them, but also strips *legitimate* underscore headers, which can break
an app in a confusing way, so it is opt-in locally and applied automatically
by the public profile.

## Dashboard

| Variable | Default | Meaning |
|---|---|---|
| `PORTTA_DASHBOARD` | `false` | Enable Traefik's dashboard |
| `PORTTA_DASHBOARD_BIND_ADDRESS` | `127.0.0.1` | Interface for the dashboard port |
| `PORTTA_DASHBOARD_PORT` | `8080` | Host port |

The dashboard exposes your full routing table. It is served on its own port,
never through the `web`/`websecure` entrypoints, so it can never appear under
the public wildcard domain. `doctor` fails if it is enabled on a non-loopback
address.

## Databases by hostname

| Variable | Default | Meaning |
|---|---|---|
| `PORTTA_TCP` | `false` | Publish one entrypoint per protocol and route on the hostname |
| `PORTTA_TCP_POSTGRES_PORT` | `5432` | Host port for the PostgreSQL entrypoint |
| `PORTTA_TCP_REDIS_PORT` | `6379` | Host port for the Redis entrypoint |

Off by default, and opt-in twice: the gateway publishes the entrypoints, and a
project's datastore has to carry the router labels before anything routes to
it. Refused on the `remote-public` profile. TLS is required, because the
hostname travels in the TLS handshake. PostgreSQL and Redis work; MySQL cannot.
See [tcp-routing.md](tcp-routing.md).

## Web panel

| Variable | Default | Meaning |
|---|---|---|
| `PORTTA_WEB` | `false` | Start the administration panel with the gateway |
| `PORTTA_WEB_BIND_ADDRESS` | `127.0.0.1` | Interface the panel is published on |
| `PORTTA_WEB_PORT` | `8081` | Host port |
| `PORTTA_WEB_EXPOSE` | `local` | `local`, or `vpn` to add a Traefik router |
| `PORTTA_WEB_HOST` | `portta-web` | Hostname label used by `vpn` |
| `PORTTA_WEB_READ_ONLY` | `false` | Refuse every mutating endpoint |
| `PORTTA_WEB_DEV` | `false` | Development mode, Vite with HMR in front |
| `PORTTA_WEB_DEV_PORT` | `5173` | Vite's host port in development mode |
| `PORTTA_WEB_NETWORK` | `portta-web` | The panel's own internal control network |
| `PORTTA_WEB_USER` | owner of `.env` | User the panel container runs as, so Settings can save |
| `PORTTA_APPLY` | `false` | Prepare the applier the panel may start to run `portta up` ([ADR 0026](adr/0026-applying-settings-from-the-panel.md)) |
| `PORTTA_DB_NETWORK` | `portta-data` | Internal panel-to-PostgreSQL network |
| `PORTTA_DB_VOLUME` | `portta-db` | Named volume holding panel data |
| `PORTTA_RUNTIME_DB_PASSWORD` | generated | **Secret.** Panel PostgreSQL credential |
| `PORTTA_RUNTIME_DATABASE_URL` | empty | Development/test bootstrap override; normally Compose supplies it |
| `PORTTA_AUTH_SECRET` | generated | **Secret.** HMAC key for host-scoped login sessions |
| `PORTTA_AUTH_IMAGE` | Portta release image | Image running the isolated auth process |
| `PORTTA_RUNTIME_DOCS` | `true` | Serve this documentation at `/docs`, from the panel image. Static text with no host information in it, so a routed panel may serve it |
| `PORTTA_RUNTIME_API_DOCS` | empty | Serve the API reference and its console at `/docs/api`. Empty means the safe default: on for loopback, off when routed |

The panel binds loopback by default. Routed `vpn` and `public` modes require a
credential and use Portta ForwardAuth; `vpn` is refused on the `remote-public`
profile. On a Linux host set `PORTTA_WEB_USER` to
`$(id -u):$(id -g)` if you want the Settings page to be able to write `.env`.

`portta web up` sets these for you and generates the database credential
without printing it. PostgreSQL publishes no host port and remains a soft
dependency: the Docker-backed panel still starts if it is unavailable. See
[web-ui.md](web-ui.md), [authentication.md](authentication.md) and [persistence.md](persistence.md).

## TLS

| Variable | Default | Meaning |
|---|---|---|
| `TLS_ENABLED` | `false` | Master switch for HTTPS |
| `TLS_MODE` | `local` | `local` (local CA) or `acme` (Let's Encrypt) |
| `ACME_EMAIL` | — | Required when `TLS_MODE=acme` |
| `ACME_CA_SERVER` | production LE | Point at staging while testing |
| `ACME_CHALLENGE` | `dns` | `dns` (one wildcard, needs a credential) or `http` (one per hostname, needs `:80`) |
| `ACME_DNS_PROVIDER` | `cloudflare` | lego provider name for DNS-01 |
| `ACME_DNS_RESOLVERS` | `1.1.1.1:53,8.8.8.8:53` | Propagation checks |

Wildcard certificates require DNS-01; HTTP-01 cannot issue them, which is why
`dns` is the default. A public gateway that would rather not hold a DNS
credential can set `ACME_CHALLENGE=http` and get a certificate per hostname
instead — see [DNS and TLS](dns-and-tls.md). Use `ACME_CA_SERVER` with the
staging endpoint while you get either working, because Let's Encrypt rate
limits are unforgiving.

## Private access

| Variable | Default | Meaning |
|---|---|---|
| `TAILSCALE_ENABLED` | `false` | Run the Tailscale component |
| `TAILSCALE_HOSTNAME` | `portta` | Node name on the tailnet |
| `TS_AUTHKEY` | — | **Secret.** Prefer an ephemeral, tagged, pre-authorized key |
| `TS_EXTRA_ARGS` | — | Extra flags for `tailscale up` |
| `PRIVATE_DOMAIN` | — | Wildcard namespace served over the VPN |

## Public access

| Variable | Default | Meaning |
|---|---|---|
| `PUBLIC_ENABLED` | `false` | Opt in to internet exposure |
| `PUBLIC_DOMAIN` | — | Public wildcard, e.g. `dev.example.com` |

Off by default and deliberately awkward to turn on. `portta public enable`
prints exactly what will become reachable and asks for confirmation.

## Cloudflare

| Variable | Default | Meaning |
|---|---|---|
| `CLOUDFLARE_ENABLED` | `false` | Use Cloudflare for DNS-01 |
| `CF_DNS_API_TOKEN` | — | **Secret.** Scoped API Token |
| `CLOUDFLARE_ZONE` | — | Target zone |

Use a scoped token with `Zone:DNS:Edit` on the one zone. Never the Global API
Key, which authenticates everything in the account and cannot be scoped.

## Secrets

`.env` is git-ignored, `bootstrap` writes it `0600`, `inspect` prints `<set>`
rather than values, and lint fails on tracked auth keys or private keys. Gateway
state, including ACME material, lives under `state/`, which is also ignored.
