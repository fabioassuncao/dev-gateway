# Examples

Self-contained stacks used to exercise the gateway against shapes that look
like real development environments. `demo-a` and `demo-b` remain the CI
fixtures: two unrelated projects on the same internal ports, with no host-port
conflicts. The others cover simpler and denser layouts, a monorepo, and a
project that never adopted the gateway.

| Demo | Shape | On the gateway |
|---|---|---|
| [`demo-a`](demo-a) | whoami web + api, postgres, redis | web, api |
| [`demo-b`](demo-b) | nginx web + whoami api, postgres, redis | web, api |
| [`demo-site`](demo-site) | single nginx site | web |
| [`demo-shop`](demo-shop) | nginx, api, Node worker, MySQL, Redis, Mailpit, RustFS | web, api, mailpit UI, rustfs console |
| [`demo-monorepo`](demo-monorepo) | web, admin, api, worker, postgres, redis, mailpit | web, admin, api, mailpit |
| [`demo-external`](demo-external) | nginx + redis, **no overlay** | nothing (External Docker) |

Every adopted demo publishes **no** host ports. Databases, caches, workers and
the S3 API stay on the project's private network; HTTP surfaces join
`portta` through `compose.portta.yaml`.

Each directory holds:

- `compose.yaml` — the project as it exists without the gateway
- `compose.portta.yaml` — networks and labels only (except `demo-external`)

## Running them

```bash
# from the portta repository
portta up local

cd docker/examples/demo-a
docker compose -f compose.yaml -f compose.portta.yaml up -d

cd ../demo-b
docker compose -f compose.yaml -f compose.portta.yaml up -d

cd ../demo-site
docker compose -f compose.yaml -f compose.portta.yaml up -d

cd ../demo-shop
docker compose -f compose.yaml -f compose.portta.yaml up -d

cd ../demo-monorepo
docker compose -f compose.yaml -f compose.portta.yaml up -d

# never adopted: no overlay on purpose
cd ../demo-external
docker compose up -d

portta urls
```

Useful hostnames:

```
http://demo-a-web.localhost
http://demo-a-api.localhost
http://demo-b-web.localhost
http://demo-b-api.localhost
http://demo-site-web.localhost
http://demo-shop-web.localhost
http://demo-shop-api.localhost
http://demo-shop-mailpit.localhost
http://demo-shop-rustfs.localhost/rustfs/console/
http://demo-monorepo-web.localhost
http://demo-monorepo-admin.localhost
http://demo-monorepo-api.localhost
http://demo-monorepo-mailpit.localhost
```

Or `just up --demo` / `./bin/portta up --demo` for every stack under
`docker/examples/` plus the panel records from each `portta.example.json`.
`demo-external` is started (it is the External Docker fixture) but has no
manifest, on purpose.

## Running the same project twice

`COMPOSE_PROJECT_NAME` is the namespace. Set it to something else and you get
a second, fully independent copy, with its own containers, volumes, network and
hostnames:

```bash
cd docker/examples/demo-a
COMPOSE_PROJECT_NAME=demo-a-issue-1 \
  docker compose -f compose.yaml -f compose.portta.yaml up -d
# -> http://demo-a-issue-1-web.localhost
```

Nothing had to change inside the project, and the first copy keeps running.
