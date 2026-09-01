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
| [0007](0007-tailscale-sidecar.md) | Traefik runs inside the Tailscale container's network namespace | Accepted |
| [0008](0008-web-panel-socket-proxy.md) | The web panel gets its own Docker socket proxy | Accepted |
| [0009](0009-tcp-routing-by-hostname.md) | Databases are told apart by hostname, with TLS terminated at the gateway | Accepted |
| [0010](0010-git-collected-on-the-host.md) | Git is collected on the host, and the panel only reads the result | Accepted |
| [0011](0011-panel-reads-traefik-writes-one-file.md) | The panel reads Traefik's API, and writes exactly two generated files | Accepted |
| [0012](0012-panel-authentication-is-traefiks.md) | The panel's authentication is Traefik's, and public stays refused | Accepted |
| [0013](0013-what-the-panel-persists.md) | The panel persists decisions, never runtime observations | Accepted |
| [0017](0017-no-docker-sdk.md) | The panel speaks the Docker Engine API directly, without a general SDK | Accepted |
