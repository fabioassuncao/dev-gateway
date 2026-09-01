# Monorepos

A monorepo needs nothing special. It is one Compose project with more services
in it, and the gateway already keys everything off the Compose project name.

```
base-empresarial/
  apps/
    web/          Dockerfile
    admin/        Dockerfile
  services/
    api/          Dockerfile
    worker/       Dockerfile
    importer/     Dockerfile
  compose.yaml
  compose.portta.yaml
```

One namespace, one private network, one set of volumes, and a hostname per
service that serves HTTP:

```
base-empresarial-web.localhost
base-empresarial-admin.localhost
base-empresarial-api.localhost
```

`worker` and `importer` serve no HTTP, so they get no networks and no labels
and keep running exactly as they did.

See [`templates/overlays/06-monorepo.yaml`](../templates/overlays/06-monorepo.yaml).

## What stays in the monorepo

Everything. Dockerfiles, build contexts, volumes, the Compose file, the release
process. The gateway centralises **routing**, not builds and not deployment. It
never needs to know your directory layout, and there is nothing to configure in
the gateway when you add an app.

Adding one is a three-line change to your own overlay:

```yaml
  new-app:
    networks: [default, portta]
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=${PORTTA_NETWORK:-portta}"
      - "traefik.http.services.${COMPOSE_PROJECT_NAME}-new-app.loadbalancer.server.port=3000"
```

## One namespace or several?

**One** is the default and almost always right. The services share a private
network, so they reach each other by service name, and one `docker compose up`
brings the whole thing up.

**Several**, a separate Compose project per app, makes sense only when apps
are genuinely independent: separate databases, separate lifecycles, and you
routinely run one without the others. The cost is real: they no longer share a
private network, so cross-app calls have to go through the gateway by hostname,
and you manage several namespaces by hand.

If you do split:

```bash
COMPOSE_PROJECT_NAME=base-empresarial-web   docker compose -f apps/web/compose.yaml up -d
COMPOSE_PROJECT_NAME=base-empresarial-api   docker compose -f services/api/compose.yaml up -d
```

Note the hostnames become `base-empresarial-web-web.localhost`, with the
namespace and the service name both in there. Usually a reason to keep one
namespace.

## Worktrees of a monorepo

Identical to any other project: one variable.

```bash
git worktree add ../base-empresarial-issue59 issue59
cd ../base-empresarial-issue59
echo "COMPOSE_PROJECT_NAME=base-empresarial-issue59" >> .env
docker compose -f compose.yaml -f compose.portta.yaml up -d
```

Every app in the worktree gets its own hostname, and the whole worktree gets
its own database. Both copies run at once.

## Shared build layers

Monorepos often share a base image between apps. That is a build concern and
the gateway is not involved, but it does interact with namespaces in one way:
if you tag a shared base image with a fixed name, two worktrees building
concurrently will race to overwrite it.

Tag per namespace, or build the base once and reference it read-only:

```yaml
  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    image: ${COMPOSE_PROJECT_NAME}-web
```

## Analyzing one

```bash
portta analyze /path/to/monorepo
```

It reads the resolved Compose model, so it sees every service regardless of
where its Dockerfile lives, classifies each, and proposes only the ones that
look like they serve HTTP.

## A monorepo is one repository in one workspace

The workspace model does not treat a monorepo as a special case: it is a
workspace that owns exactly one repository. What differs is what runs against
it — several worktrees, each its own `COMPOSE_PROJECT_NAME`, each adopted by
the same workspace.

```
Workspace  "Plataforma"
├── repositories   acme/plataforma
└── environments   plataforma            (label)
                   plataforma-issue182   (repo-match)
                   plataforma-issue190    (repo-match)
```

The worktrees stay independent environments, exactly as they are today: their
overrides do not inherit, their hostnames do not collide, and stopping one
touches none of the others. The workspace is what says they are the same
product.

See [github.md](github.md#workspaces-repositories-and-the-environments-that-belong-to-them).
