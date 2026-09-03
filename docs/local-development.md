# Local development (macOS and Linux workstations)

## Requirements

**macOS**: [OrbStack](https://orbstack.dev) or Docker Desktop, Git, a shell.
**Linux**: Docker Engine 24+, the Compose v2 plugin, Git, a shell.

OrbStack is the recommended runtime on macOS: it starts faster and uses much
less memory than Docker Desktop. The gateway does **not** depend on any
OrbStack-specific API. Anything OrbStack-only is an optimisation the gateway
detects and offers, never something it requires.

Note the versions: Docker Compose **v2** (the `docker compose` plugin). The
standalone `docker-compose` v1 binary is not supported.

## Setup

```bash
git clone git@github.com:fabioassuncao/portta.git
cd portta
cp .env.example .env

./bin/portta bootstrap
./bin/portta up local
./bin/portta doctor
```

`bootstrap` is idempotent, so run it whenever you want a health check with
repairs to the parts it owns. It never deletes anything.

Put the CLI on your `PATH` so you can call it from any project directory:

```bash
ln -s "$PWD/bin/portta" /usr/local/bin/portta
```

## Why `.localhost` needs no configuration

`localhost` is reserved by [RFC 6761](https://www.rfc-editor.org/rfc/rfc6761),
which requires resolvers to map it, **and its subdomains**, to loopback
without consulting DNS.

In practice that means `demo-a-web.localhost` resolves to `127.0.0.1` with:

- no `/etc/hosts` editing,
- no `dnsmasq`,
- no local DNS daemon,
- nothing to do when a new project or worktree appears.

This works out of the box in Safari, Chrome, Firefox and Edge, and in `curl`
on macOS and modern Linux distributions.

**Known limits.** A few tools resolve names themselves and do not implement the
RFC. Older Go binaries and some JVM HTTP clients are the usual suspects; musl
libc historically did not special-case it either, so a plain Alpine container
may fail to resolve `*.localhost` even though your browser can. If you hit
this, either use the container-to-container name over the shared network, or
set `PORTTA_DOMAIN` to a real domain that resolves to `127.0.0.1`.

`doctor` probes this and tells you if it cannot confirm resolution.

## Everyday use

```bash
portta status     # profile, listeners, how many routes are live
portta urls       # every hostname currently served
portta logs       # follow gateway logs
portta doctor     # when something does not behave
```

Starting and stopping applications is not the gateway's job. Do that from the
project's own directory, as you always have.

## Resetting a checkout

`portta dev --reset` wipes the panel database and starts again the same way
`make dev` does. `portta reset` is that command. Make cannot take `--reset`
as a flag; it uses variables:

```bash
make dev RESET=1          # asks for confirmation on a TTY
make dev RESET=1 YES=1    # same, non-interactive (`--yes`)
make reset                # alias for the above
make reset EXAMPLES=1     # then import docker/examples
```

**What takes the time.** The first `make dev` or `make reset` in a checkout,
and any run after a dependency change, builds the panel image: two `npm ci`, a
build across three workspaces and a render of the documentation. Several
minutes is normal. It now says so before it starts and streams BuildKit's
progress while it runs, and anything else that goes quiet reports how long it
has been going. `make dev VERBOSE=1` shows every child process;
`./bin/portta --quiet reset` shows none of it. A `Ctrl-C` during a build is
safe: BuildKit keeps the cache it has earned.

**Gone.** The named volume `${PORTTA_DB_VOLUME:-portta-db}` — Projects, tasks,
tokens, activity, the GitHub projection — and the snapshots `repos scan` and
the host collector rewrite under `state/git/` and `state/metrics/`.

**Kept.** `.env`, GitHub App keys under `state/github/`, `state/auth/`, ACME
and Tailscale material, and every development project's containers, networks
and volumes. This is a fresh panel on a developer checkout, not an empty
machine.

Demo shops under `docker/examples` are out of the default. For that full
cycle: `make demo-down && make reset && make demo-up && make examples`.

## Running several environments

`COMPOSE_PROJECT_NAME` is the namespace:

```bash
cd ~/Projects/base-empresarial
docker compose -f compose.yaml -f compose.portta.yaml up -d
# -> base-empresarial-web.localhost

git worktree add ../base-empresarial-issue59 issue59
cd ../base-empresarial-issue59
COMPOSE_PROJECT_NAME=base-empresarial-issue59 \
  docker compose -f compose.yaml -f compose.portta.yaml up -d
# -> base-empresarial-issue59-web.localhost
```

Both run at once, each with its own containers, network, volumes and database.
Putting `COMPOSE_PROJECT_NAME` in the worktree's `.env` saves repeating it.

## HTTPS locally (optional)

Plain HTTP works with no setup, and for most local work that is the right
choice. HTTPS is worth enabling when you need Secure cookies, service workers,
or anything else gated behind a secure context.

It is opt-in and never required. See [dns-and-tls.md](dns-and-tls.md).

## If port 80 is taken

```bash
lsof -nP -iTCP:80 -sTCP:LISTEN     # macOS
ss -ltnp sport = :80               # Linux
```

Either stop the other process, or move the gateway:

```
PORTTA_HTTP_PORT=8080
```

URLs then carry the port: `http://demo-a-web.localhost:8080`.

## Uninstalling

```bash
portta down
docker network rm portta    # only once no project is attached
rm -rf state/
```

Your projects, their volumes and their databases are untouched, because the
gateway never owned them.
