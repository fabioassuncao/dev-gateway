# Develop Portta

Work in an isolated checkout and namespace. Follow the [shared-host rules](../agent-guidelines.md) before starting or removing infrastructure.

### Development, with hot reloading

```bash
just dev                     # gateway up, panel with hot reloading, pending SQL
just db-migrate              # apply pending SQL without a restart
./bin/portta web dev         # the panel alone, on a gateway already running
```

One container, one port. The panel is a single process, so Next's HMR arrives on
the same `http://127.0.0.1:8081` the API answers on — there is no second server
and no second port to remember.

`apps/web/{app,components,lib,messages,server,public}`, `apps/auth/{src,ui}`,
`packages/*/src`,
`packages/db/drizzle` and the Markdown under `docs/` are bind-mounted, so the
image's `node_modules` stay in place. An edit to a page or a component reloads
in the browser; an edit to `server/main.ts` or the ForwardAuth backend restarts
its process, and its login UI rebuilds in watch mode. A newly
generated migration is visible to the next `portta db migrate` without
rebuilding the image.

The book icon and every `/docs/…` link stay on that same port: the documentation
is a route of the panel, not a second site.

`./bin/portta web up` goes back to the built image.

If you do have Node on the host and prefer to work outside containers:

```bash
npm ci                                          # from the repository root
npm run dev --workspace=portta-web              # the panel on :8081
npm test --workspace=portta-web
npm run test:e2e --workspace=portta-web
npm run openapi --workspace=portta-contracts    # refresh packages/contracts/openapi.json
```

`npm run build --workspace=portta-web` is `next build` followed by an esbuild
bundle of `server/main.ts` into `dist/server.mjs`. It needs the workspace
packages built first (`core → contracts → db → server`): under
`NODE_ENV=production` the `development` export condition no longer applies, so
each resolves to its `dist/`. The image does exactly that, in that order.


### Regenerating the screenshots

The images on this page and in the README are produced by the real panel, run
against a fixed host described in `apps/web/e2e/demo-host.mjs`, a host metrics
snapshot the script writes itself (no collector runs), and a disposable
PostgreSQL that imports `docker/examples/*/portta.example.json`. Every frame is
1440×900 (`deviceScaleFactor` 2, so the files are 2880×1800):

```bash
npm run screenshots --workspace=portta-web
```

They are generated rather than taken by hand so they stay in step with the UI,
show the same thing every time, and never contain whatever happened to be
running on the machine that produced them. Change the host in `demo-host.mjs`
and the framing in `e2e/screenshots.mjs`.

---

## The panel in development

`just dev` starts the panel and ForwardAuth with hot reloading. The panel stays
on **one port**: it is a single
Node process — Next, the Hono API, the event stream and the WebSocket upgrades
behind one dispatcher — so `http://127.0.0.1:8081` is the API, the pages, the
documentation and HMR. ForwardAuth watches its TypeScript process and rebuilds
the static login page when `apps/auth/ui` changes. The images provide Node and
dependencies; source comes from bind mounts, so an ordinary edit does not build
or recreate a container.


## The panel's database

PostgreSQL is required: the panel exits rather than starting without it, and
`portta web up` brings it up alongside. Working on the schema is two commands:

```bash
# after editing packages/db/src/schema/*.ts
npm run db:generate --workspace=portta-db   # write the migration
npm run db:check --workspace=portta-db      # prove the schema and the SQL agree
portta db migrate                           # apply it to a panel already running
```

`web-dev.yaml` mounts `packages/db/drizzle`, so a newly generated migration is
visible to the running container without rebuilding the image.

Suites do not need any of this: they open PGlite and apply the same migrations
(`createTestDb()` from `portta-db/testing`). See [persistence](../product/concepts/persistence.md).


## Resetting a checkout

> [!CAUTION]
> Reset removes this checkout's panel database and its stored Projects, tasks and tokens. Verify ownership and back up any state you need before proceeding.

`portta dev --reset` wipes the panel database and starts again the same way
`just dev` does. `portta reset` is that command. Flags pass through:

```bash
just reset                # asks for confirmation on a TTY
just reset --yes          # same, non-interactive
just reset --yes --demo   # then recreate docker/examples and import their panel records
just dev --reset --demo   # the same sequence
```

**What takes the time.** The first `just dev` or `just reset` in a checkout,
and any run after a dependency, lockfile or Dockerfile change, builds the shared
development base. Source-only changes do not. It streams BuildKit's progress,
and anything else that goes quiet reports how long it has been going.
`just dev --verbose` shows every child process;
`./bin/portta --quiet reset` shows none of it. A `Ctrl-C` during a build is
safe: BuildKit keeps the cache it has earned.

**Gone.** The named volume `${PORTTA_DB_VOLUME:-portta-db}` — Projects, tasks,
tokens, activity, the GitHub projection — and the snapshots `repos scan` and
the host collector rewrite under `state/git/` and `state/metrics/`.

**Kept.** `.env`, GitHub App keys under `state/github/`, `state/auth/`, ACME
and Tailscale material, and every development project's containers, networks
and volumes. This is a fresh panel on a developer checkout, not an empty
machine.

Demo stacks under `docker/examples` are out of the default. `--demo` is the
complete demonstration — containers and panel records — on `up`, `dev` and
`reset`:

```bash
just reset --yes --demo
# same as: ./bin/portta reset --yes --demo
```
