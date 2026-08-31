# Public access

Disabled by default. Turning it on is the most consequential thing the gateway
can do, so it is explicit, it shows you exactly what changes, and it asks.

## Enabling

```bash
dev-gateway public enable
```

Before changing anything it prints:

- the wildcard domain that becomes reachable;
- the interface (`0.0.0.0` — every interface on the host);
- the ports;
- the TLS state, and a warning if traffic would be plaintext;
- **the exact list of URLs** that would be served;
- what is never published, in any profile.

Then it asks. On yes it sets `PUBLIC_ENABLED=true` and
`DEV_GATEWAY_PROFILE=remote-public` in `.env` and applies the profile.

```bash
dev-gateway public status
dev-gateway public disable
```

`disable` switches back to `remote-private` when Tailscale or a private domain
is configured, and to `local` otherwise. Consumer projects keep running
throughout.

## What public mode does and does not change

It changes **who can reach Traefik**. That is all.

It does not publish anything new. A service is still routed only when it sets
`traefik.enable=true`, and databases and caches are still never on the shared
network. What was invisible stays invisible; what was already routed becomes
reachable from the internet.

Never public, in any profile:

- PostgreSQL, MySQL, Redis, MongoDB and other datastores
- the Docker API and the socket proxy
- the Traefik dashboard

`doctor` and the CI exposure job both fail if any of those bind `0.0.0.0`.

## Prerequisites

```env
PUBLIC_ENABLED=false          # public enable flips this
PUBLIC_DOMAIN=dev.example.com
TLS_ENABLED=true
TLS_MODE=acme
ACME_EMAIL=you@example.com
```

`public enable` refuses without `PUBLIC_DOMAIN`, and warns loudly — asking for
a second confirmation — if TLS is off.

A wildcard `A` record for `*.dev.example.com` must point at the host's public
address: `dev-gateway dns setup`.

Firewall: 80 and 443 have to be open. Nothing else does. See
[firewall.md](firewall.md).

## Hardening

Public mode raises `aliasHeadersStrategy` to `delete`, so a client cannot
forge a header Traefik manages by exploiting a backend that normalises
underscores.

There is **no authentication layer**. Anything routed is reachable by anyone.
For a development environment that usually matters, so add a middleware to the
routers that need it — basic auth, or an OAuth forward-auth service. The
gateway ships reusable middlewares in `config/traefik/dynamic/` and is
deliberately not coupled to any identity provider.

A per-router example:

```yaml
labels:
  - "traefik.http.routers.web.middlewares=my-auth@file"
```

## Deciding

Use the private profile. It is the default recommendation because it gives you
the same thing — remote access from anywhere — without an open port.

Public mode earns its keep for external webhooks, a demo for someone who cannot
join your tailnet, or testing something that must see a public certificate.
When the reason passes, turn it off:

```bash
dev-gateway public disable
```
