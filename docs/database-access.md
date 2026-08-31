# Database access

Short version, by situation. The reasoning is in
[tcp-access.md](tcp-access.md).

## From the application

Nothing changes and nothing is needed. The application reaches
`postgres:5432` over the project's own private network, exactly as it always
did.

## From a GUI on this machine

```bash
dev-gateway access open --project base-empresarial --service postgres
# -> 127.0.0.1:33077
```

| | |
|---|---|
| Host | `127.0.0.1` |
| Port | the one printed |
| User / password / database | the project's own, from its `.env` |

Add `--local-port 55432` to keep a saved connection working across sessions.
Otherwise the kernel picks a new free port each time, which is what lets four
databases be open at once.

```bash
dev-gateway access list
dev-gateway access close --project base-empresarial
```

## From the terminal, or from an agent

Do not open a bridge. Run the client inside the project's network:

```bash
dev-gateway db psql --project base-empresarial
dev-gateway db psql --project base-empresarial -- -c 'select count(*) from users'
dev-gateway db psql --project base-empresarial -- -f migrations/001.sql
```

Nothing is published, and the container is removed when you exit. Credentials
come from the target container's own environment.

MySQL works the same way:

```bash
dev-gateway db mysql --project some-project
```

Or, with no gateway involved at all:

```bash
docker compose exec postgres psql -U app -d app
```

## From a VPS

```bash
dev-gateway remote access open deploy@vps \
  --project base-empresarial --service postgres
# -> 127.0.0.1:55432
```

Point the client at that. The bridge on the VPS binds *its* loopback and is
never published; the SSH tunnel is what carries it here. Works over Tailscale
SSH with the same syntax.

```bash
dev-gateway remote access list
dev-gateway remote access close <id>
```

## Every day, at a stable address

```bash
dev-gateway service publish --private \
  --project base-empresarial --service postgres
```

A dedicated forwarder with a stable alias on the gateway's access network,
reachable over the tailnet at the standard port. Each published service gets
its own forwarder; project networks are never merged. See
[tailscale-services.md](tailscale-services.md).

## Several databases at once

That is the whole point, and it needs no special handling:

```bash
dev-gateway access open --project base-empresarial --service postgres  # -> :33077
dev-gateway access open --project base-eleicoes    --service postgres  # -> :33079
dev-gateway access open --project issue-flow       --service postgres  # -> :33081
dev-gateway access list
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
dev-gateway db psql --project base-empresarial -- -c '\copy users to stdout csv' > users.csv
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
