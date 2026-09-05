# Back up and restore the panel

Back up the panel database and its installation configuration together.

> [!CAUTION]
> Restoring replaces existing database objects. Confirm the target installation and retain a current backup before continuing.

## Prerequisites

Use the CLI against the intended Portta installation with Docker available.
The database clients run in an ephemeral toolbox container; the host does not
need `psql`. Credentials come from the installation environment.

Check database health before continuing:

```bash
portta db status
```

These commands operate on the **panel database**. For a Project's own
PostgreSQL, use [Connect to project databases](database-access.md).

## Create a backup

Write a PostgreSQL custom-format archive to a new backup file:

```bash
portta db dump > portta.dump
```

The command writes only the archive to stdout. Retain the installation's `.env`
with the backup: its credentials are not part of the archive. Store both with
restricted access. A successful command produces the archive without changing
running database objects.

## Restore a backup

Confirm the target installation and create a current backup before replacing
its state. Restore the saved archive and accept the CLI confirmation:

```bash
portta db restore portta.dump
```

Restore uses `--clean --if-exists` and ownership-neutral objects. It stops on
an error; a failed restore may already have changed database objects. Keep the
previous backup until you have verified the restored installation.

After a successful restore, open the panel and verify its Projects, users and
settings. For automation reading the archive from stdin, confirmation must be
explicitly disabled with `portta --yes db restore < portta.dump`.

## Configuration and an existing volume

`PORTTA_RUNTIME_DB_MODE=managed` uses internal DNS `db` and port `5432`; neither
is a pretend configurable setting. `PORTTA_RUNTIME_DB_USER`, `_NAME` and
`_PASSWORD` are shared by PostgreSQL and the application's URL resolver. The
password is generated into `.env` once. It is never generated inside PostgreSQL
or discovered from a different container. The database has no host port.

`PORTTA_RUNTIME_DB_MODE=external` requires `PORTTA_RUNTIME_DATABASE_URL`.
The managed fields are inactive, no local `db` is started, and readiness comes
from the application's authenticated connection and migrations. Administrative
clients use the same resolver, running in the toolbox on the gateway network.
Client TLS file paths must be available inside the toolbox; they are not mounted
from arbitrary host paths automatically.

Changing `.env` does not modify an initialized PostgreSQL cluster. The installer
never issues an automatic `ALTER USER` or deletes a volume to make a password
work. An incompatible credential prevents the panel from starting. Recover the
original `.env`/backup first. For deliberate password rotation, connect using the
current credential (`portta db shell`), use psql's interactive `\password` for
the configured role, update `PORTTA_RUNTIME_DB_PASSWORD` on the host, and recreate
the panel/database containers with `portta up`. A changed database or role name
requires explicit PostgreSQL administration or dump/restore, not new defaults.

See [Persistence](../concepts/persistence.md) for state ownership and lifecycle, or [Develop the database schema](../../development/database-development.md) for schema migrations.
