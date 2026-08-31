# Architecture decision records

Short records of decisions that are expensive to reverse. Each states the
context, the decision, and what it costs us.

| # | Decision | Status |
|---|---|---|
| [0001](0001-decoupled-infrastructure.md) | The gateway is infrastructure, not a parent project | Accepted |
| [0002](0002-docker-socket-proxy.md) | Traefik reaches Docker through a filtered read-only proxy | Accepted |
| [0003](0003-traefik-static-config-via-env.md) | Traefik static configuration lives in environment variables | Accepted |
| [0004](0004-pinned-versions.md) | Every component image pins an explicit version | Accepted |
| [0005](0005-hostname-convention.md) | Hostnames are derived from the labels Compose already injects | Accepted |
| [0006](0006-compose-project-name-as-namespace.md) | `COMPOSE_PROJECT_NAME` is the namespace for parallel environments | Accepted |
