// Entry point. One process: the API, and the built UI beside it, so the user
// has a single address to remember.

import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isAuthenticated, loadConfig } from './config.ts'
import { DockerClient } from './docker/client.ts'
import { createSnapshotCache } from './core/inventory.ts'
import { LiveHub } from './core/events.ts'
import { createVerdictCache } from './core/traefik.ts'
import { createApp } from './app.ts'
import { GENERATED_FILES, reconcilePanelProtection } from './core/dynamic.ts'
import { Database } from './db/index.ts'
import { GitHubIntegration } from './integrations/github/index.ts'
import { createReconciliationSchedule, intervalMinutes } from './integrations/github/sync/schedule.ts'

const config = loadConfig()

// The panel's ForwardAuth record and middleware live in state/files Traefik
// watches. They are reconciled here as well as by `portta web auth set`, so a
// panel started with a credential in .env is never behind stale protection. A directory the panel
// cannot write is a diagnostic, not a reason to refuse to start: on Linux it
// may well belong to another user, and the CLI writes the same file.
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

const client = new DockerClient(config.dockerApi)
let db: Database | null = null
if (config.databaseUrl !== null) {
  try {
    db = Database.open(config.databaseUrl)
    await db.initialize()
    process.stdout.write(`database ready: ${db.status().migrations.join(', ') || 'no migrations'}\n`)
  } catch (error) {
    process.stdout.write(`database temporarily unavailable; persistence will retry: ${String(error)}\n`)
  }
}

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

// Reconciliation on an interval, which is what makes the projection fresh on
// the documented default: a loopback panel cannot receive webhook deliveries,
// so without this the only trigger is somebody pressing Sync. See
// integrations/github/sync/schedule.ts, and set GITHUB_SYNC_INTERVAL_MINUTES=0
// on a panel that does receive webhooks.
const schedule = db && github.status().configured
  ? createReconciliationSchedule(() => github.require(), db, {
      minutes: intervalMinutes(process.env['GITHUB_SYNC_INTERVAL_MINUTES']),
      onError: (error) => process.stdout.write(`github reconciliation failed; the projection is unchanged: ${String(error)}\n`),
    })
  : null
if (schedule) {
  schedule.start()
  if (schedule.running) {
    process.stdout.write(`github: reconciling every ${intervalMinutes(process.env['GITHUB_SYNC_INTERVAL_MINUTES'])} minute(s)\n`)
  }
}

const cache = createSnapshotCache(client, config, 1000, (snapshot) => db?.recordEnvironmentsSeen(snapshot.environments))
const hub = new LiveHub(client, cache)
const verdict = createVerdictCache(config)

const app = createApp({ config, client, cache, hub, verdict, db, github })

const indexHtml = join(config.uiDir, 'index.html')
if (existsSync(indexHtml)) {
  app.use('/*', serveStatic({ root: config.uiDir }))
  // Hash routing means only `/` is ever requested, but a stray deep link
  // should still land on the app rather than a 404 from the API.
  app.get('*', (c) => c.html(readFileSync(indexHtml, 'utf8')))
} else {
  app.get('/', (c) =>
    c.text(
      'The panel UI is not built in this image.\n' +
        'In development the UI is served by Vite; run: portta web dev\n',
      200,
    ),
  )
}

hub.start()

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  process.stdout.write(
    `portta panel ${config.panelVersion} listening on http://${config.host}:${info.port}\n`,
  )
  process.stdout.write(`docker api: ${config.dockerApi}\n`)
})

function shutdown(signal: string): void {
  process.stdout.write(`\n${signal}: shutting the panel down\n`)
  hub.stop()
  schedule?.stop()
  server.close(() => {
    if (db) void db.close().finally(() => process.exit(0))
    else process.exit(0)
  })
  setTimeout(() => process.exit(0), 3000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
