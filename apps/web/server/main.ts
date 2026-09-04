// The panel, as one process.
//
// Boot order matters and is the point of this file: configuration, then the
// database (a failure here is a failure to start), then Docker and the caches,
// then Next, then the dispatcher, then listen, then the jobs. Nothing serves a
// request until everything it might need exists.

import { createServer } from 'node:http'
import next from 'next'
import {
  createApp,
  createCommitWatch,
  createMaintenance,
  createReconciliationSchedule,
  createSnapshotCache,
  createVerdictCache,
  Database,
  DockerClient,
  GENERATED_FILES,
  GitHubIntegration,
  intervalMinutes,
  isAuthenticated,
  LiveHub,
  loadConfig,
  reconcilePanelProtection,
  type AppDeps,
} from 'portta-server'
import { createPortta, type Startable } from './compose.ts'
import { registerDeps } from '../lib/server/deps.ts'

const config = loadConfig()
const development = process.env['NODE_ENV'] !== 'production'

// The panel's ForwardAuth record and middleware live in state/files Traefik
// watches. They are reconciled here as well as by `portta web auth set`, so a
// panel started with a credential in .env is never behind stale protection. A
// directory the panel cannot write is a diagnostic, not a reason to refuse to
// start: on Linux it may well belong to another user, and the CLI writes the
// same file.
const rendered = reconcilePanelProtection(config, {
  mode: config.webAuth,
  user: config.webAuthUser,
  hash: config.webAuthHash,
})
if (rendered.written) {
  process.stdout.write(`wrote ${GENERATED_FILES.auth}: ${rendered.reason}\n`)
} else if (config.webAuth === 'basic' && !isAuthenticated(config)) {
  process.stdout.write('PORTTA_WEB_AUTH=basic without a credential: run portta web auth set\n')
}

// PostgreSQL is a boot dependency, not a soft one. A panel that starts without
// it can show Docker and nothing else, and every write it accepts is lost — so
// it says what is missing and stops, rather than degrading into a half-panel
// somebody has to diagnose.
if (config.databaseUrl === null) {
  process.stderr.write(
    'PORTTA_RUNTIME_DATABASE_URL is not set; the panel needs PostgreSQL.\n' +
      'Run: portta web up  (it starts the database beside the panel)\n',
  )
  process.exit(1)
}

const db = Database.open(config.databaseUrl)
try {
  await db.initialize()
  process.stdout.write(`database ready: ${db.status().migrations.join(', ') || 'no migrations'}\n`)
} catch (error) {
  process.stderr.write(`the panel cannot open its database: ${String(error)}\n`)
  process.exit(1)
}

const client = new DockerClient(config.dockerApi)

// Off by default. Configured but unreachable is a status the panel reports,
// never a reason to fail to start or to slow a Docker-backed page down.
const github = new GitHubIntegration({
  enabled: config.githubEnabled,
  appId: config.githubAppId,
  privateKeyFile: config.githubPrivateKeyFile,
  apiUrl: config.githubApiUrl,
  timeoutMs: config.githubTimeoutMs,
})
if (github.status().configured) {
  if (!github.keyIsPrivate()) {
    process.stdout.write(`${config.githubPrivateKeyFile} is readable by more than its owner: chmod 600 it\n`)
  }
  void github.check().then((status) => {
    process.stdout.write(
      status.available
        ? `github: connected as app ${status.appId}\n`
        : `github temporarily unavailable; the projection is still readable: ${status.reason}\n`,
    )
  })
}

const cache = createSnapshotCache(client, config, 1000, (snapshot) =>
  db.recordEnvironmentsSeen(snapshot.environments),
)
const hub = new LiveHub(client, cache)
const verdict = createVerdictCache(config)

const deps: AppDeps = { config, client, cache, hub, verdict, db, github }

// Before `next.prepare()`: a page rendered during preparation would otherwise
// find nothing registered. See lib/server/deps.ts for why this is a global.
registerDeps(deps)

// `process.cwd()` is apps/web: `npm run dev`, `next build` and the image's
// WORKDIR all agree on it, and the bundled entry point has no directory of its
// own that Next could read `.next` and `next.config.ts` from.
const app = next({ dev: development, turbopack: development, dir: process.cwd() })
await app.prepare()

// Reconciliation on an interval, which is what makes the projection fresh on
// the documented default: a loopback panel cannot receive webhook deliveries,
// so without this the only trigger is somebody pressing Sync. Set
// GITHUB_SYNC_INTERVAL_MINUTES=0 on a panel that does receive webhooks.
const schedule = github.status().configured
  ? createReconciliationSchedule(() => github.require(), db, {
      minutes: intervalMinutes(process.env['GITHUB_SYNC_INTERVAL_MINUTES']),
      onError: (error) =>
        process.stdout.write(`github reconciliation failed; the projection is unchanged: ${String(error)}\n`),
    })
  : null

// What the repositories produced, noticed from the host scan once a minute,
// and the hourly housekeeping: quiet sessions abandoned, old activity pruned.
const jobs: Startable[] = [hub, createCommitWatch(config, db, hub), createMaintenance(db, hub)]
if (schedule) jobs.push(schedule)

const portta = createPortta({
  api: createApp(deps),
  next: app.getRequestHandler(),
  nextUpgrade: development ? app.getUpgradeHandler() : undefined,
  jobs,
  close: () => db.close(),
})

const server = createServer(portta.handle)
server.on('upgrade', portta.upgrade)

server.listen(config.port, config.host, () => {
  process.stdout.write(`portta panel ${config.panelVersion} listening on http://${config.host}:${config.port}\n`)
  process.stdout.write(`docker api: ${config.dockerApi}\n`)
  if (schedule?.running) {
    process.stdout.write(
      `github: reconciling every ${intervalMinutes(process.env['GITHUB_SYNC_INTERVAL_MINUTES'])} minute(s)\n`,
    )
  }
  portta.start()
})

function shutdown(signal: string): void {
  process.stdout.write(`\n${signal}: shutting the panel down\n`)
  void portta.stop().finally(() => {
    server.close(() => process.exit(0))
    // A connection that will not close must not hold the panel open forever.
    setTimeout(() => process.exit(0), 3000).unref()
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
