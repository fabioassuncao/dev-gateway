# Adopting a project

Your project stays where it is, in its own repository, started from its own
directory. Adoption means adding one file to it.

## Start here

```bash
dev-gateway analyze /path/to/project
```

It reads the project and reports what adoption would take: every service and
what it looks like, the host ports it publishes and what already holds them,
fixed container names, datastores that are published, and whether the namespace
is implicit. It writes nothing.

Then generate the overlay:

```bash
dev-gateway init /path/to/project --dry-run   # see the file first
dev-gateway init /path/to/project
```

`init` creates exactly one new file. It never edits `compose.yaml`, never
touches volumes or databases, shows you the file and a diff before writing, and
requires `--force` to overwrite (keeping a backup).

## The contract

A compatible project:

1. uses Docker and Compose v2;
2. sets a unique `COMPOSE_PROJECT_NAME`;
3. keeps its own private network;
4. declares `dev-gateway` as an external network;
5. attaches **only** its published HTTP services to it;
6. sets `traefik.enable=true` on those services;
7. declares the internal port when the image's `EXPOSE` does not match it;
8. avoids `container_name:`;
9. drops `ports:` for HTTP services reached through the gateway;
10. does not publish databases or caches on the host.

Nothing else. No Dockerfile changes, no directory moves, no shared base image.

## The overlay

Keep integration in its own file so `compose.yaml` still describes the
application, and the project still runs standalone without the gateway:

```yaml
# compose.dev-gateway.yaml
services:
  web:
    networks:
      - default        # keep reaching postgres/redis privately
      - dev-gateway    # accept traffic from the gateway
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=dev-gateway"
      - "traefik.http.services.${COMPOSE_PROJECT_NAME}-web.loadbalancer.server.port=3000"

  api:
    networks: [default, dev-gateway]
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=dev-gateway"
      - "traefik.http.services.${COMPOSE_PROJECT_NAME}-api.loadbalancer.server.port=8000"

networks:
  dev-gateway:
    external: true
    name: dev-gateway
```

```bash
docker compose -f compose.yaml -f compose.dev-gateway.yaml up -d
```

Set `COMPOSE_FILE=compose.yaml:compose.dev-gateway.yaml` in the project's
`.env` to drop the `-f` flags entirely.

Working examples: [`examples/demo-a`](../examples/demo-a) and
[`examples/demo-b`](../examples/demo-b). Templates for the usual project shapes
— single web, web + API, full stack, several APIs, monorepo, worktree,
non-standard ports — are in [`templates/`](../templates/).

## Two rules that are easy to get wrong

**Write labels in list form.** Compose interpolates `${VAR}` inside a list entry
but **not** inside a mapping key. In map form the Traefik service name stays the
literal `${COMPOSE_PROJECT_NAME}` and every worktree of the project collapses
onto one load balancer.

**Prefix Traefik service names with the namespace.** Those names are flat across
the whole host; two projects both declaring `web` get merged into one load
balancer and start receiving each other's traffic.

`dev-gateway doctor` reports both.

## Checklist

- [ ] `COMPOSE_PROJECT_NAME` set, unique on this host
- [ ] no `container_name:` on any service
- [ ] HTTP services join `default` **and** `dev-gateway`
- [ ] databases and caches join **only** `default`
- [ ] `traefik.enable=true` on HTTP services only
- [ ] internal port declared when it differs from the image's `EXPOSE`
- [ ] Traefik service names prefixed with `${COMPOSE_PROJECT_NAME}`
- [ ] labels written in list form
- [ ] `ports:` removed for services reached through the gateway
- [ ] `ports:` removed for databases and caches
- [ ] `dev-gateway urls` lists the expected hostnames
- [ ] a second copy with a different `COMPOSE_PROJECT_NAME` runs alongside the first
- [ ] `dev-gateway doctor` is clean

## Verifying

```bash
dev-gateway urls --project <name>
curl -sI http://<name>-web.localhost | head -1

# the real test: a second environment, in parallel
COMPOSE_PROJECT_NAME=<name>-issue1 \
  docker compose -f compose.yaml -f compose.dev-gateway.yaml up -d
dev-gateway urls
```

Both environments should be listed and both should answer.

## Documenting it in the project

Copy [`templates/project/DEV-GATEWAY.md`](../templates/project/DEV-GATEWAY.md)
into the project and adjust the names. It covers only what someone working on
that project needs — how to start it, its URLs, how to reach its database, how
to run a second copy — and leaves the rules here.

## Monorepos

Nothing changes: a monorepo is one Compose project with more services in it.
See [monorepos.md](monorepos.md).

## Keeping the project runnable without the gateway

The overlay adds only networks and labels, so `docker compose up -d` on its own
still works — you just lose hostname routing. If a developer needs a published
port for a one-off, that is their `compose.override.yaml`, not the shared file.
