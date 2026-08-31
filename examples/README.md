# Examples

Two self-contained stacks used to prove the gateway's core promise: several
projects running at once, on the same internal ports, without a single host
port conflict.

| | `demo-a` | `demo-b` |
|---|---|---|
| web | whoami on **3000** | nginx on **3000** |
| api | whoami on **8000** | whoami on **8000** |
| database | postgres on **5432** | postgres on **5432** |
| cache | redis on **6379** | redis on **6379** |
| published host ports | none | none |

Each directory holds two files worth reading:

- `compose.yaml` is the project as it exists without the gateway. It still runs
  standalone with `docker compose up -d`.
- `compose.dev-gateway.yaml` is the whole integration, which is nothing but
  networks and labels.

## Running them

```bash
# from the dev-gateway repository
dev-gateway up local

cd examples/demo-a
docker compose -f compose.yaml -f compose.dev-gateway.yaml up -d

cd ../demo-b
docker compose -f compose.yaml -f compose.dev-gateway.yaml up -d

dev-gateway urls
```

```
http://demo-a-web.localhost
http://demo-a-api.localhost
http://demo-b-web.localhost
http://demo-b-api.localhost
```

## Running the same project twice

`COMPOSE_PROJECT_NAME` is the namespace. Set it to something else and you get
a second, fully independent copy, with its own containers, volumes, network and
hostnames:

```bash
cd examples/demo-a
COMPOSE_PROJECT_NAME=demo-a-issue-1 \
  docker compose -f compose.yaml -f compose.dev-gateway.yaml up -d
# -> http://demo-a-issue-1-web.localhost
```

Nothing had to change inside the project, and the first copy keeps running.
