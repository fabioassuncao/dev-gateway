import { serve } from '@hono/node-server'
import { createAuthApp } from './app.ts'
import { loadAuthConfig, validateAuthConfig } from './config.ts'

const config = loadAuthConfig()
validateAuthConfig(config)

serve({ fetch: createAuthApp({ config }).fetch, hostname: config.host, port: config.port }, (info) => {
  process.stdout.write(`portta-auth listening on ${info.address}:${info.port}\n`)
})
