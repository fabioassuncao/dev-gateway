# Authentication

Portta answers two different questions with two different mechanisms, and
keeping them apart is what makes each one simple.

**The panel** asks who *you* are. It signs people in itself: a session cookie
issued by the panel, a role that says what you may do, and optionally a Portta
token for a CLI or a coding agent. Nothing in front of it decides anything.

**A project hostname or a share** asks whether a request may reach an
application Portta routes but does not own. That is a separate process,
`portta-auth`, which Traefik consults through ForwardAuth before the application
receives anything.

```text
browser -> panel            -> session cookie -> the panel decides
agent   -> panel            -> Bearer ptt_…   -> the panel decides
browser -> Traefik -> ForwardAuth -> login/session -> a project's application
```

## The panel

### Two modes

| `PORTTA_AUTH_MODE` | What it means |
|---|---|
| `disabled` (default) | Every request is the local operator, holding everything. Allowed **only** on loopback: the panel refuses to start otherwise. |
| `required` | Everybody signs in. `/setup` creates the owner; everyone else is created by an administrator. |

`disabled` is not a weaker password. It is the statement that reaching the panel
already means having the machine, which is true of `127.0.0.1` and of nothing
else. `portta web up --expose vpn|public|domain` refuses to run without
`required`, and so does `portta config set panel.access`.

Switching `disabled → required` on an existing installation costs nothing: the
next boot has no owner, so the panel offers `/setup`. Switching back is accepted
only on loopback; the users and their tokens stay in the database, inert.

### The first user

A panel in `required` mode with no owner has exactly one page. Every route
redirects to `/setup`, and the API answers `503 setup_required` to everything
except `GET /api/health`, `GET /api/auth/status` and `POST /api/auth/setup`.

```bash
# in a browser
open http://127.0.0.1:8081/setup

# or from the host, which is what a server with no browser needs
printf %s "$PASSWORD" | portta auth bootstrap \
  --name 'Ada Lovelace' --email ada@example.com --password-stdin
```

The first account becomes the `owner`. Public sign-up does not exist: the
endpoint is disabled, and the panel refuses a second one even if it is reached.
Two people opening `/setup` at the same moment produce one owner and one 409 —
the creation happens under an advisory lock.

### Roles

| Role | Holds |
|---|---|
| `owner` | Everything. Exactly one, and the only one who can transfer ownership. |
| `admin` | Everything except acting on the owner. |
| `developer` | Works: tasks, sessions, environments, containers, repositories. Does not administer, destroy, or open network paths. |
| `viewer` | Reads, and their own tokens. |

Every API operation declares the permission it needs as `resource:action`, and
the OpenAPI document publishes it as `x-portta-permission`. A request with no
credential gets `401`; a request with one that is not enough gets `403`. Those
two are never interchanged.

Read-only mode (`PORTTA_WEB_READ_ONLY=true`) intersects every principal with the
reads, whoever signed in.

### Sessions and the second factor

Sign-in sets `portta.session_token`: `HttpOnly`, `SameSite=Lax`, `Path=/`, and
`Secure` whenever `PORTTA_PANEL_URL` is HTTPS. Sessions last seven days and are
refreshed daily. Signing out revokes the session; banning a user takes effect on
their *next request*, not their next sign-in.

Sign-in, TOTP verification and backup codes are rate-limited to five attempts in
ten minutes. A user who has turned on a second factor is sent to `/two-factor`
after their password is accepted.

There is no email transport in a self-hosted panel, so there is no reset link.
A forgotten password is reset from the host that owns the panel.

### Tokens for the CLI and agents

A Portta token is a `ptt_`-prefixed Bearer credential belonging to a user. It
never exceeds its owner's role: what it holds is the intersection of its own
scopes and that role, so lowering somebody's role lowers every token they made
without touching the tokens. Revoking one takes effect on the next request.

### Agents in `disabled` mode

With no sign-in there is nobody to be, so `X-Portta-Actor` is attribution: it
says which caller behind the machine this is. The one thing it decides is that a
request announcing itself as an agent is held to what agents may do — the
`agentPermissions` setting, which defaults to a developer minus the three things
that change how the panel behaves (`environment:settings`, `repository:manage`,
`github:sync`).

## Project hostnames and shares

`portta-auth` publishes no host port, has no Docker socket or database, and
mounts `state/auth/protections.json` read-only. Credentials use scrypt; migrated
apr1, bcrypt and `{SHA}` hashes remain valid. Hashes never appear in generated
Traefik YAML. This process knows nothing about the panel, its users or its
tokens.

A successful login there sets `__portta_session` as `HttpOnly`, `SameSite=Lax`,
`Path=/`, host-only, and `Secure` on HTTPS, for twelve hours. Each protected host
has an epoch; changing or removing its credential invalidates the sessions that
came before. `/__portta/auth` is reserved on every protected host, and only
same-host paths are accepted as redirects.

REST, webhook, health-check, SSE and WebSocket requests never receive a login
redirect. They get 401 until they supply the Basic credential:

```bash
curl -u reviewer:password https://demo-web.example.com/api/health
```

Failed logins are delayed progressively; five failures in ten minutes lock that
host/IP pair for fifteen minutes. Logs carry scope, client address and outcome —
never a password, cookie or Authorization value.

### Shares

```bash
portta share list
portta share revoke a7f3
portta share gc
```

Protected-share passwords are shown once. Rotation bumps the share epoch; revoke
and garbage collection remove its protection record.

### Protecting a project hostname

Portta never edits a consumer project's router. Create the host record, then opt
that router into the generated middleware in the project's own Compose file:

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

- `PORTTA_AUTH_SECRET` in `.env` signs the panel's sessions and tokens, and the
  ForwardAuth process's cookies. `portta bootstrap` generates it. Rotating it
  signs everybody out of both.
- The panel's users, sessions and tokens live in its PostgreSQL database.
- `state/auth/protections.json` holds project and share credentials. It is
  versioned, atomic and mode 0600.
- `config/traefik/dynamic/portta-auth.yaml` contains only services, routers and
  middleware — no credential material. `portta-panel.yaml` is written empty:
  nothing routes through Traefik middleware to reach the panel any more.
- `portta doctor` checks the mode against the bind address, the secret, the
  database, and the auth container's health.

See [ADR 0035](adr/0035-authentication-lives-in-the-panel.md) for why the panel
authenticates itself, and [ADR 0027](adr/0027-forward-authentication-service.md)
for the ForwardAuth trust boundary.
