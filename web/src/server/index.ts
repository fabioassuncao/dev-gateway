// Entry point. One process: the API, and the built UI beside it, so the user
// has a single address to remember.

import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig } from './config.ts'
import { DockerClient } from './docker/client.ts'
import { createSnapshotCache } from './core/inventory.ts'
import { LiveHub } from './core/events.ts'
import { createApp } from './app.ts'

const config = loadConfig()
const client = new DockerClient(config.dockerApi)
const cache = createSnapshotCache(client, config)
const hub = new LiveHub(client, cache)

const app = createApp({ config, client, cache, hub })

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
        'In development the UI is served by Vite; run: dev-gateway web dev\n',
      200,
    ),
  )
}

hub.start()

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  process.stdout.write(
    `dev-gateway panel ${config.panelVersion} listening on http://${config.host}:${info.port}\n`,
  )
  process.stdout.write(`docker api: ${config.dockerApi}\n`)
})

function shutdown(signal: string): void {
  process.stdout.write(`\n${signal}: shutting the panel down\n`)
  hub.stop()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
