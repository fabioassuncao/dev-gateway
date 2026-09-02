# Database access

Short version, by situation. The reasoning is in
[tcp-access.md](tcp-access.md).

## From the application

Nothing changes and nothing is needed. The application reaches
`postgres:5432` over the project's own private network, exactly as it always
did.

## From a GUI on this machine

```bash
portta access open --project base-empresarial --service postgres
# -> 127.0.0.1:33077
```

| | |
|---|---|
| Host | `127.0.0.1` |
| Port | the one printed |
| User / password / database | the project's own, from its `.env` — or from the panel's Connect panel, which reads the container environment on demand |

Add `--local-port 55432` to keep a saved connection working across sessions.
Otherwise the kernel picks a new free port each time, which is what lets four
databases be open at once.

```bash
portta access list
portta access close --project base-empresarial
```

## From the terminal, or from an agent

Do not open a bridge. Run the client inside the project's network:

```bash
portta db psql --project base-empresarial
portta db psql --project base-empresarial -- -c 'select count(*) from users'
portta db psql --project base-empresarial -- -f migrations/001.sql
```

Nothing is published, and the container is removed when you exit. Credentials
come from the target container's own environment.

MySQL works the same way:

```bash
portta db mysql --project some-project
```

Or, with no gateway involved at all:

```bash
docker compose exec postgres psql -U app -d app
```

## From a VPS

```bash
portta remote access open deploy@vps \
  --project base-empresarial --service postgres
# -> 127.0.0.1:55432
```

Point the client at that. The bridge on the VPS binds *its* loopback and is
never published; the SSH tunnel is what carries it here. Works over Tailscale
SSH with the same syntax.

```bash
portta remote access list
portta remote access close <id>
```

## Every day, at a stable address

```bash
portta service publish --private \
  --project base-empresarial --service postgres
```

A dedicated forwarder with a stable alias on the gateway's access network,
reachable over the tailnet at the standard port. Each published service gets
its own forwarder; project networks are never merged. See
[tailscale-services.md](tailscale-services.md).

## Several databases at once

That is the whole point, and it needs no special handling:

```bash
portta access open --project base-empresarial --service postgres  # -> :33077
portta access open --project base-eleicoes    --service postgres  # -> :33079
portta access open --project issue-flow       --service postgres  # -> :33081
portta access list
```

All three still listen on 5432 inside their containers. None publishes it.

## Migrations and seeds

Run them where they have always run, inside the project:

```bash
docker compose run --rm api npm run migrate
docker compose exec api php artisan migrate
```

The gateway has no opinion about migrations and no access to your data. It
never runs one for you.

## Backups

```bash
portta db psql --project base-empresarial -- -c '\copy users to stdout csv' > users.csv
```

For a full dump, use `pg_dump` inside the project so the file lands where you
want it:

```bash
docker compose exec -T postgres pg_dump -U app app > backup.sql
```

## What not to do

**Do not add `ports: ["5432:5432"]`** to get a database "temporarily" onto the
host. That is the port conflict this whole design removes, and it makes the
database reachable by everything else on the machine.

**Do not point two worktrees at one database.** Let Compose create a volume per
namespace. Two environments writing to one database corrupt each other, and it
is silent until it is not.

**Do not publish a database on `0.0.0.0`.** `doctor` fails on it, and
`service publish --public` refuses outright.

## Reaching it by hostname instead

If the gateway has `PORTTA_TCP=true` and the project opted in, its
PostgreSQL has a stable address that needs no bridge and no free port:

```bash
psql "postgresql://demo@base-empresarial-postgres.localhost:5432/demo?sslmode=require"
```

The `sslmode` is not decoration: the hostname travels inside the TLS handshake,
and without TLS there is nothing for the gateway to route on. MySQL cannot do
this at all. See [tcp-routing.md](tcp-routing.md).

The panel's Access page lists every address that applies to this host — LAN,
tailnet, domain, loopback bridge — each with its scope. **Connect** reads the
container environment on demand and fills the connection string when the
image uses conventional variables (`POSTGRES_*`, …). The password is masked
until you ask for it, and can be copied without being revealed. Opening that
panel creates no route, bridge or published port.
