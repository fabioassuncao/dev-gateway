# Troubleshooting

Start here:

```bash
dev-gateway doctor
```

It checks the runtime, networks, component health, exposure, DNS, TLS, route
collisions and label mistakes, and prints a suggested fix for anything that
fails. It never changes anything.

---

## A hostname does not resolve

```bash
ping demo-a-web.localhost
```

`*.localhost` is required to resolve to loopback by RFC 6761 and needs no
configuration. If it fails, the resolver in play does not implement it, most
often an old Go binary, a JVM HTTP client, or musl inside an Alpine container.

Point `DEV_GATEWAY_DOMAIN` at a real domain resolving to `127.0.0.1`, or reach
the service by container name over the shared network instead.

## 404 from the gateway

Traefik answered, but no router matched. In order of likelihood:

```bash
dev-gateway urls        # is the hostname listed at all?
```

**Not listed.** The container did not opt in. Check it has
`traefik.enable=true`, and that it is actually running:

```bash
docker inspect <container> --format '{{json .Config.Labels}}' | jq
```

**Listed but 404.** Usually a stale route. Traefik discovers asynchronously;
give it a couple of seconds after `up`. If it persists:

```bash
DEV_GATEWAY_LOG_LEVEL=DEBUG dev-gateway up local
dev-gateway logs traefik
```

**A literal `${...}` in a label.** The labels were written in map form.
Compose interpolates `${VAR}` inside a *list* entry but not inside a mapping
key. Rewrite as a list:

```yaml
labels:
  - "traefik.http.services.${COMPOSE_PROJECT_NAME}-web.loadbalancer.server.port=3000"
```

`doctor` reports this specifically.

## 502 / 504 from the gateway

The router matched but Traefik could not reach the backend.

**Wrong port.** Traefik guesses from the image's `EXPOSE` when no port is
declared. If your app listens on 3000 but the image exposes 80, say so:

```yaml
- "traefik.http.services.${COMPOSE_PROJECT_NAME}-web.loadbalancer.server.port=3000"
```

**Not on the shared network.** The service must join `dev-gateway` as well as
its own network:

```bash
docker inspect <container> --format '{{json .NetworkSettings.Networks}}' | jq 'keys'
```

**Wrong network chosen.** A multi-homed container has two addresses; if Traefik
picked the private one it cannot reach it. Add:

```yaml
- "traefik.docker.network=dev-gateway"
```

**The app is bound to `127.0.0.1` inside its container**, so nothing outside
the container can reach it. It must listen on `0.0.0.0`.

## One project receives another project's traffic

Traefik service names are one flat namespace across the host. Two projects
declaring `traefik.http.services.web...` are merged into a single load
balancer. Prefix with the namespace:

```yaml
- "traefik.http.services.${COMPOSE_PROJECT_NAME}-web.loadbalancer.server.port=3000"
```

`doctor` reports both this and hostname collisions between projects whose names
differ only in punctuation (`foo_bar` and `foo-bar` normalise identically).

## Port 80 or 443 is already in use

```bash
lsof -nP -iTCP:80 -sTCP:LISTEN     # macOS
ss -ltnp sport = :80               # Linux
```

Stop the other process, or set `DEV_GATEWAY_HTTP_PORT=8080` and use
`http://demo-a-web.localhost:8080`.

## Traefik keeps restarting

Almost always a bad static configuration key. Traefik names the exact node it
could not decode:

```bash
docker logs dev-gateway-traefik-1 2>&1 | tail -5
# failed to decode configuration from environment variables: field not found, node: ...
```

Nested keys are the usual cause: `aliasHeadersStrategy` lives under `http`, so
the variable is `TRAEFIK_ENTRYPOINTS_WEB_HTTP_ALIASHEADERSSTRATEGY`, not
`TRAEFIK_ENTRYPOINTS_WEB_ALIASHEADERSSTRATEGY`.

## The socket proxy is unhealthy

Its entrypoint renders a config into `/tmp`, and the container runs
`read_only: true`. It needs the tmpfs mounts declared in `compose.yaml`:

```bash
docker logs dev-gateway-socket-proxy-1
# can't create /tmp/haproxy.cfg: Read-only file system
```

## Postgres 18 will not start

PostgreSQL 18+ images store data in a major-version subdirectory and refuse to
start when `.../data` is mounted directly. Mount the parent:

```yaml
volumes:
  - pgdata:/var/lib/postgresql      # not /var/lib/postgresql/data
```

## `dev-gateway down` did not remove the shared network

That is intentional. Other projects are attached to it, and the gateway never
removes a network other people are using. Remove it deliberately once nothing
is attached:

```bash
docker network inspect dev-gateway --format '{{ len .Containers }}'
docker network rm dev-gateway
```

## Everything looks right and it still does not work

```bash
dev-gateway doctor --json | jq '.checks[] | select(.status != "pass")'
dev-gateway inspect
docker logs dev-gateway-traefik-1 --tail 50
```

Include those three in a bug report.
