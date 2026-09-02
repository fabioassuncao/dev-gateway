# Authentication

Portta can put the same branded login in front of the panel, a protected share,
or a project-owned HTTP router. Traefik checks every protected request through
the separate `portta-auth` process before the application receives it.

```text
browser -> Traefik -> ForwardAuth -> login/session -> application
curl    -> Traefik -> ForwardAuth -> HTTP Basic    -> application
```

The auth process publishes no host port, has no Docker socket or database, and
mounts `state/auth/protections.json` read-only. Credentials use scrypt; migrated
apr1, bcrypt and `{SHA}` hashes remain valid. Hashes never appear in generated
Traefik YAML.

## Browser sessions

A successful login sets `__portta_session` as `HttpOnly`, `SameSite=Lax`,
`Path=/`, host-only, and `Secure` on HTTPS. Sessions last twelve hours. Each
protected host has an epoch; changing or removing its credential invalidates
the previous sessions. The logout action clears the browser cookie.

The original path and query are restored after login. Only same-host paths are
accepted as redirects. `/__portta/auth` is reserved on every protected host.

REST, webhook, health-check, SSE and WebSocket requests never receive a login
redirect. They get 401 until they supply the existing Basic credential, for
example:

```bash
curl -u reviewer:password https://demo-web.example.com/api/health
```

Failed logins are delayed progressively and five failures in ten minutes lock
that host/IP pair for fifteen minutes. Logs contain scope, client address and
outcome—never a password, cookie or Authorization value.

## Panel and shares

The existing commands keep their shape:

```bash
portta web auth set
portta web auth set --user dev --password-stdin
portta web auth status
portta web auth clear

portta share list
portta share revoke a7f3
portta share gc
```

Protected-share passwords are shown once. Rotation bumps the share epoch;
revoke and garbage collection remove its protection record.

## Protecting a project hostname

Portta never edits a consumer project's router. Create the host record, then
opt the router into the generated middleware in that project's Compose file:

```bash
portta auth protect demo-web.example.com --project demo --service web
```

```yaml
labels:
  - "traefik.http.routers.demo-web.middlewares=portta-forward-auth@file"
```

Inspect or remove records without exposing hashes:

```bash
portta auth status
portta auth status demo-web.example.com
portta auth unprotect demo-web.example.com
```

Removing the record does not edit the project label. Until the label is removed,
the unresolved protection fails closed.

## State and recovery

- `PORTTA_AUTH_SECRET` in `.env` signs sessions. `portta bootstrap` generates it.
- `state/auth/protections.json` is versioned, atomic and mode 0600.
- `config/traefik/dynamic/portta-auth.yaml` contains only services, routers and
  middleware—no credential material.
- `portta doctor` checks the secret, store mode and auth container health.

Rotating `PORTTA_AUTH_SECRET` signs everyone out. If a password is lost, set a
new one; hashes cannot be recovered. See [ADR 0027](adr/0027-forward-authentication-service.md)
for the trust boundary and migration contract.
