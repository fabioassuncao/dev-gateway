# Panel architecture

## Architecture

```text
Browser
   |                              http, loopback by default
Panel (Next.js + Hono, one process, one container)
   |-- filtered Docker API, internal control network
Panel socket proxy
   |                              read-only bind of the socket
Docker
Panel -- durable decisions --> PostgreSQL (private data network, no host port)
```

The panel application is a single container running a single Node process, and
that process is a dispatcher over four things:

```text
/api/*        the Hono API, including the event stream
upgrade /ws/* WebSocket, authorised before the handshake
/*            Next's handler: the pages, their data, their assets
```

`apps/web/server/main.ts` composes them and `apps/web/server/compose.ts` decides
which is which. One process because the panel is loopback by default with no
proxy in front of it, a session cookie needs a single origin, and one container
is what `portta web up` already starts.

A page is a Server Component: it calls `services.*` from `portta-server`
directly and never fetches the API this same process is serving. What it reads
is handed to the client as `initialData`, so the first paint is the page rather
than a spinner, and the event stream keeps it alive from there. A mutation
always goes through `/api` — the same contract the CLI and MCP use.

It joins two networks: the gateway's shared network (so it can be published, and routed by
Traefik when that is asked for) and its own `internal` control network, where
its socket proxy lives. A third, dedicated internal network connects only the
panel and its PostgreSQL database.

It never sees the Docker socket, has no Docker CLI, and reads exactly two
paths from the host: `.env`, which its Settings page edits, and `VERSION`.

Why a second socket proxy rather than Traefik's: Traefik's is read-only and
must stay that way, while the panel needs the container lifecycle. The two
permission sets are kept apart, and the panel enforces its own allowlist on top
of the proxy's. Its purpose-built client pins Docker Engine API `v1.43`, the
API implemented by the project's minimum supported Docker Engine 24, so a
newer daemon cannot silently change the response contract. See
[ADR 0008](adr/0008-web-panel-socket-proxy.md) and
[ADR 0017](adr/0017-no-docker-sdk.md).

### Technologies

| Layer | Choice |
|---|---|
| Pages | [Next.js 16](https://nextjs.org/) App Router, React 19, Server Components by default |
| Server | Node 24, TypeScript, a custom `http` server that dispatches to Next and Hono |
| API | [Hono](https://hono.dev/), Zod for input validation, OpenAPI generated from the routes |
| UI | Tailwind CSS 4, Radix primitives, TanStack Query, next-themes, i18next |
| Persistence | PostgreSQL 18, Drizzle ORM, generated migrations |
| Live updates | Server-sent events, fed by Docker's own event stream |
| Tests | Vitest (services, API, components, schema), Playwright (end to end) |

There is no Vite in the panel. The one Vite build left in the repository makes
the login page `apps/auth` serves, which is a separate service on a separate
origin and may not import from the panel.

### Where the code lives

```text
apps/web/
├── app/                 routes. (panel)/ has the shell; docs/ is the documentation
├── components/          ui/ primitives, shell/, entities/, tasks/, settings/
├── lib/                 api client, queries, live, i18n, docs collector, format
├── messages/            en/*.json, pt-BR/*.json
├── server/              main.ts (the process) and compose.ts (the dispatcher)
└── public/              the favicon, and nothing that needs a request elsewhere
```

### Shell and navigation

The sidebar has two groups. **Development** — Overview and Projects — is the
daily flow; **Infrastructure** — Services, Docker, Network, Access, Gateway —
is the technical perspective over the same host; Settings sits alone at the
end. Each section sets a contextual browser title ending in `Portta`; a
project, task, repository or environment route refines it with its name. The
title belongs to the route: every page exports `generateMetadata`, so tabs,
bookmarks and history never inherit the previous page's title. The built UI also serves its SVG favicon
locally, with no browser request to a third-party asset.

At `md` and above, the sidebar can collapse from its 224px labelled form to a
48px icon rail, with the `[` key or the control at its foot. The `portta-sidebar`
preference survives reloads when local storage is available and safely defaults
to expanded when it is not. Sections are links, so they open in a new tab like
any link; icons keep tooltips and accessible labels, and the active section
carries `aria-current="page"`. Below `md`, navigation remains the labelled
horizontal strip and the collapse control is hidden.

`⌘K` (`Ctrl+K` elsewhere) opens the command menu: every section, every project
and its tasks, the actions of the current page (a new task, folding the
sidebar) and the preferences (theme, language). Typing narrows it; Enter runs
the highlighted entry. The visual language of the whole panel is described in
[Design system](design-system.md).

PostgreSQL stores decisions and identity, not observations. Everything live on
screen (services, URLs, networks, ports, health and bridges) is still read from
Docker at request time, so a container that disappears simply stops appearing.
The database keeps the gateway instance, project identity, typed preferences
and integration configuration. If it is down, the panel and its Docker-backed
pages remain available and diagnostics report the degraded state. See
[Panel persistence](../product/concepts/persistence.md).

---


## Out of scope

Not implemented, and not planned for this version: users, roles and RBAC (the
panel has one credential, held by Traefik), historical metrics, monitoring,
Kubernetes, deployments, a Compose editor, a web terminal, image management,
volume management, network management, arbitrary container creation, arbitrary
Traefik configuration, an embedded Traefik dashboard, a tunnel service, or
being a replacement for Portainer or Docker Desktop.

Tasks, the board, sessions, activity and the GitHub binding **shipped**;
[Connect GitHub](../product/guides/github.md) and [MCP reference](../product/reference/mcp.md) describe them. What remains out
of scope there: GitHub comments are never projected (reading one is a link to
GitHub), GitHub Projects v2 fields are not read, and a web editor or a file
browser beyond the instruction files is a later step. Local Git stays
host-collected ([ADR 0010](adr/0010-git-collected-on-the-host.md), amended by
[ADR 0032](adr/0032-portta-development-model.md)).

Sharing is deliberately narrow: one additional hostname per service, with an
expiry, on a network the gateway already answers. It is not authentication for
a project and never becomes an identity layer.

The panel exists to make the gateway pleasant to use day to day, for people and
for agents, and to stop there.

## No Octokit

The panel image resolves three runtime dependencies, and that smallness is part
of what makes it safe to run on a host that may be reachable over a VPN. What
this needs is an RS256 JWT, a token exchange, Link-header pagination and
rate-limit accounting — about two hundred lines on `node:crypto` and `fetch`.

**Added runtime dependencies: zero.** It is the same trade
[ADR 0011](adr/0011-panel-reads-traefik-writes-one-file.md) made for apr1, and
it is revisited if the surface grows past what is honest to maintain.
