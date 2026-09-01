# Dev Gateway

A technical arrangement I am experimenting with to organise my own development
flow across several containerised projects, locally and on a VPS: everything I
work on runs at the same time, on the same machine, without ever renumbering a
port or killing somebody else's containers.

It is not a product, and it is shaped around one person's habits. The
repository is public because there is no reason for it not to be. If it fits
how you work, help yourself.

```
$ dev-gateway urls
PROJECT                      SERVICE        URL
base-empresarial             api            http://base-empresarial-api.localhost
base-empresarial             web            http://base-empresarial-web.localhost
base-empresarial-issue59     api            http://base-empresarial-issue59-api.localhost
base-empresarial-issue59     web            http://base-empresarial-issue59-web.localhost
issue-flow                   web            http://issue-flow-web.localhost
```

All of those run `web` on internal port 3000 and `api` on 8000. Each has its
own Postgres on 5432 and Redis on 6379. None of them publishes a host port.

The same host, in the optional web panel:

![The Dev Gateway panel: three projects on the gateway with their services and URLs, how many containers are running outside it, and the two problems it found](.github/images/panel-overview.png)

Off by default, published on loopback: `dev-gateway web up`, then
<http://127.0.0.1:8081>. See [the panel](#web-panel).

---

## The problem

A host port can only be held by one process. So the moment two projects both
want `3000:3000` (or you check out a second worktree of the same project), you
have to pick one:

- stop the other environment, which interrupts whoever was using it;
- renumber ports inside the project, so development stops resembling production;
- keep a spreadsheet of who owns which port.

None of those scale past a couple of projects, and all of them get worse when
several agents work in parallel.

## The idea

Container ports and host ports are different things. Two containers can both
listen on 3000 forever; the conflict only exists because something publishes
that port on the host.

So publish nothing. One shared router holds 80 and 443, every project attaches
its HTTP services to one shared Docker network, and each service gets a
hostname derived from the name its Compose project already has. Databases and
caches stay on the project's own private network and are reached, when a human
actually needs them, through a temporary loopback bridge.

## What it is not

The Dev Gateway is host infrastructure, installed once. It is **not** a parent
Compose project.

It does not move your projects, clone them, mount their directories, own their
volumes or databases, or take part in their lifecycle. It never stops a
container it did not create, never removes a volume it does not own, and never
runs `docker system prune`. Your projects stay exactly where they are, in their
own repositories, started and stopped from their own directories.

See [ADR 0001](docs/adr/0001-decoupled-infrastructure.md).

## Architecture

```mermaid
flowchart TB
    client([browser / curl])
    subgraph host [Host]
        traefik[Traefik<br/>:80 :443]
        proxy[docker-socket-proxy<br/>read-only, no host port]
        socket[/var/run/docker.sock/]
        subgraph shared [dev-gateway network: shared]
            aweb[demo-a web :3000]
            aapi[demo-a api :8000]
            bweb[demo-b web :3000]
        end
        subgraph pa [demo-a_default: private]
            apg[(postgres :5432)]
            ard[(redis :6379)]
        end
        subgraph pb [demo-b_default: private]
            bpg[(postgres :5432)]
        end
    end
    client -->|"*.localhost"| traefik
    traefik --> aweb & aapi & bweb
    traefik -. "discovery only" .-> proxy
    proxy -. ro .-> socket
    aweb --- apg & ard
    aapi --- apg
    bweb --- bpg
```

Traefik only ever reaches services on the shared network. It has no route to
any project's private network, and never needs one.

## Requirements

**macOS**: [OrbStack](https://orbstack.dev) (recommended) or Docker Desktop,
Git, and a shell. **Linux**: Docker Engine 24+, the Compose v2 plugin, Git,
and a shell.

Nothing else is required on the host. `jq`, `socat`, database clients and other
tooling run in containers the gateway manages.

## Quick start

```bash
git clone git@github.com:fabioassuncao/dev-gateway.git
cd dev-gateway
cp .env.example .env

./bin/dev-gateway bootstrap
./bin/dev-gateway up local
./bin/dev-gateway doctor
```

Then try the bundled examples, two unrelated stacks that both use ports 3000
and 8000 internally:

```bash
make demo-up
```

```
http://demo-a-web.localhost
http://demo-a-api.localhost
http://demo-b-web.localhost
http://demo-b-api.localhost
```

Add `./bin` to your `PATH`, or symlink `bin/dev-gateway` somewhere on it, to
drop the `./bin/` prefix.

## Adopting a project

Your project stays where it is. You add one file to it:

```yaml
# compose.dev-gateway.yaml: the entire integration
services:
  web:
    networks: [default, dev-gateway]
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=dev-gateway"
      - "traefik.http.services.${COMPOSE_PROJECT_NAME}-web.loadbalancer.server.port=3000"

networks:
  dev-gateway:
    external: true
    name: dev-gateway
```

```bash
docker compose -f compose.yaml -f compose.dev-gateway.yaml up -d
```

Start with `dev-gateway analyze /path/to/project`, which reads the project and
reports what it would take. It never writes anything.

Full walkthrough: **[docs/adopting-projects.md](docs/adopting-projects.md)**.

## Working in parallel

`COMPOSE_PROJECT_NAME` is the namespace. Change it and you get a completely
independent environment, with its own containers, network, volumes and
hostnames:

```bash
COMPOSE_PROJECT_NAME=base-empresarial-issue59 \
  docker compose -f compose.yaml -f compose.dev-gateway.yaml up -d
# -> http://base-empresarial-issue59-web.localhost
```

The first environment keeps running. Nothing inside the project changed.

## Databases, Redis and other TCP services

They are never published on the host and never joined to the shared network.
When a human needs one (TablePlus, `psql`, `redis-cli`), the gateway opens a
temporary bridge on a free loopback port:

```bash
dev-gateway access open --project base-empresarial --service postgres
# -> 127.0.0.1:55431
```

See [docs/tcp-access.md](docs/tcp-access.md).

## Web panel

Optional, off by default, loopback only. It answers the lookups that come up
when several environments are running at once: which URL does this project have
today, what is holding that port, which containers are still up from last week,
and how do I point a GUI client at this database.

```bash
dev-gateway web up
dev-gateway web open      # http://127.0.0.1:8081
```

**Projects, not a list of containers.** Services are grouped by
`COMPOSE_PROJECT_NAME`, databases included, with every address one click from
the clipboard.

![The Projects page: each Compose project with its services, health, uptime and URLs, including a second worktree of the same project running beside it](.github/images/panel-projects.png)

**Everything else on the host, kept separate.** Containers the gateway does not
manage are shown for diagnosis, never mixed in with the projects it does, and
the port that is already taken has a name next to it.

![The Docker page: External Docker and Standalone sections, and the published ports table flagging 5432 as claimed twice](.github/images/panel-docker-external.png)

**Databases without publishing a port.** A bridge on a free loopback port,
opened when you need it and closed when you do not, with the connection string
ready to copy and no password in it.

![The Access page: an open bridge to storefront/postgres on 127.0.0.1:55431, and the other TCP services with an Open local access button](.github/images/panel-access.png)

It also offers logs, start, stop, restart, a careful removal, gateway
diagnostics and the common settings, and nothing more: it is not a Docker
management tool.

The panel runs in containers (the host still needs no Node), reads Docker
through its own filtered socket proxy, and is never published on the internet.

See **[docs/web-ui.md](docs/web-ui.md)** for the rest of it.

## Commands

| | |
|---|---|
| `dev-gateway bootstrap` | Prepare the host: runtime checks, shared network, state |
| `dev-gateway up [profile]` | Start the gateway |
| `dev-gateway down` | Stop it; applications keep running |
| `dev-gateway status` | Compact overview |
| `dev-gateway doctor` | Deep diagnostics with suggested fixes |
| `dev-gateway urls` | Hostnames currently being served |
| `dev-gateway inspect` | Resolved configuration and compose files |
| `dev-gateway update` | Pull pinned images and recreate |
| `dev-gateway web up` | Start the administration panel on loopback |

`--json` is available on `status`, `doctor` and `urls`. `make` targets mirror
these for convenience; Make is never required.

## Security

Short version: nothing is exposed unless you ask for it.

- Traefik never sees the Docker socket. A read-only, endpoint-filtered proxy on
  an `internal` network does discovery ([ADR 0002](docs/adr/0002-docker-socket-proxy.md)).
- `exposedByDefault=false`, so a service is routed only when it opts in.
- The local profile binds to `127.0.0.1`.
- The dashboard is off; when enabled it is loopback-only and never routed
  through the public entrypoints.
- Databases, caches and the Docker API are never published publicly, and
  `doctor` fails if they are.
- The web panel is off by default, binds loopback, and refuses to be published
  on the internet. It reaches Docker through a socket proxy of its own, so
  Traefik's stays read-only ([ADR 0008](docs/adr/0008-web-panel-socket-proxy.md)).

Details: **[docs/security.md](docs/security.md)**.

## Documentation

| | |
|---|---|
| [architecture.md](docs/architecture.md) | How the pieces fit together |
| [networking.md](docs/networking.md) | Networks, ports, and what talks to what |
| [configuration.md](docs/configuration.md) | Every setting in `.env` |
| [local-development.md](docs/local-development.md) | macOS and Linux workstations |
| [remote-development.md](docs/remote-development.md) | Running on a VPS |
| [tailscale.md](docs/tailscale.md) | VPN-only access |
| [dns-and-tls.md](docs/dns-and-tls.md) | Wildcard DNS and certificates |
| [public-access.md](docs/public-access.md) | Opting in to internet exposure |
| [cloudflare.md](docs/cloudflare.md) | Optional DNS automation |
| [firewall.md](docs/firewall.md) | Minimal rules, and why Docker bypasses UFW |
| [remote-bootstrap.md](docs/remote-bootstrap.md) | Preparing a host over SSH |
| [adopting-projects.md](docs/adopting-projects.md) | Adapting a project, with a checklist |
| [monorepos.md](docs/monorepos.md) | Monorepos and worktrees |
| [tcp-access.md](docs/tcp-access.md) | Why databases need a different mechanism |
| [database-access.md](docs/database-access.md) | Reaching a database, by situation |
| [redis-access.md](docs/redis-access.md) | Reaching Redis |
| [remote-tunnels.md](docs/remote-tunnels.md) | Reaching a VPS's private services |
| [tailscale-services.md](docs/tailscale-services.md) | A persistent private address |
| [web-ui.md](docs/web-ui.md) | The administration panel |
| [agent-guidelines.md](docs/agent-guidelines.md) | Rules for autonomous agents |
| [templates/](templates/) | Overlay templates for the usual project shapes |
| [security.md](docs/security.md) | Threat model and hardening |
| [troubleshooting.md](docs/troubleshooting.md) | When something does not route |
| [compatibility.md](docs/compatibility.md) | Platforms verified, and measured overhead |
| [adr/](docs/adr/) | Why things are the way they are |

## Status

Experimental (`v0.x`), and honest about it.

The local profile is exercised end to end on every change: four environments at
once, adopting an unknown project, TCP bridges to four databases, and the
lifecycle guarantees. The remote profiles are covered by configuration tests
(every profile renders, the private one never binds `0.0.0.0`), but the tailnet
and ACME paths need real credentials and are **not** exercised automatically.

See [compatibility.md](docs/compatibility.md) for what is verified where, and
[CHANGELOG.md](CHANGELOG.md) for the release notes.

Since this is a personal tool kept in the open, it changes when my own workflow
needs it to, and comes with no support promise. Issues and pull requests are
welcome; so is forking it and taking it somewhere else entirely.

## License

MIT. See [LICENSE](LICENSE).
