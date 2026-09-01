// The panel's HTTP surface: a small API, and the built UI beside it.

import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppDeps } from './routes/deps.ts'
import { statusRoutes } from './routes/status.ts'
import { projectRoutes } from './routes/projects.ts'
import { serviceRoutes } from './routes/services.ts'
import { dockerRoutes } from './routes/docker.ts'
import { networkRoutes } from './routes/network.ts'
import { accessRoutes } from './routes/access.ts'
import { gatewayRoutes } from './routes/gateway.ts'
import { configRoutes } from './routes/config.ts'
import { eventRoutes } from './routes/events.ts'
import { ActionRefused } from './core/actions.ts'
import { AccessError } from './core/access.ts'
import { ValidationError } from './core/settings.ts'
import { DockerApiError } from './docker/client.ts'
import { DockerAccessDenied } from './docker/allowlist.ts'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * A page on another site can point a form or a fetch at 127.0.0.1. Reads are
 * harmless enough behind loopback; a write is not, so one has to come from the
 * panel itself.
 */
function originAllowed(origin: string, host: string): boolean {
  if (origin === '') return true
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return false
  }
  if (parsed.host === host) return true
  return ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
}

export function createApi(deps: AppDeps): Hono {
  const api = new Hono()

  api.use('*', async (c, next) => {
    c.header('cache-control', 'no-store')
    c.header('x-content-type-options', 'nosniff')

    if (!SAFE_METHODS.has(c.req.method)) {
      if (deps.config.readOnly) {
        throw new HTTPException(403, { message: 'the panel is running in read-only mode' })
      }
      const origin = c.req.header('origin') ?? ''
      const host = c.req.header('host') ?? ''
      if (!originAllowed(origin, host)) {
        throw new HTTPException(403, { message: 'cross-origin writes are refused' })
      }
    }
    await next()
  })

  api.route('/', statusRoutes(deps))
  api.route('/', projectRoutes(deps))
  api.route('/', serviceRoutes(deps))
  api.route('/', dockerRoutes(deps))
  api.route('/', networkRoutes(deps))
  api.route('/', accessRoutes(deps))
  api.route('/', gatewayRoutes(deps))
  api.route('/', configRoutes(deps))
  api.route('/', eventRoutes(deps))

  api.all('*', (c) => c.json({ error: `no such endpoint: ${c.req.path}` }, 404))

  return api
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono()

  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ error: error.message }, error.status)
    }
    if (error instanceof ActionRefused || error instanceof AccessError) {
      return c.json({ error: error.message, hint: error.hint }, error.status as 400)
    }
    if (error instanceof ValidationError) {
      return c.json({ error: error.message, hint: 'the value was not saved' }, 400)
    }
    if (error instanceof DockerAccessDenied) {
      return c.json({ error: error.message, hint: 'this is a panel limit, not a Docker one' }, 403)
    }
    if (error instanceof DockerApiError) {
      const status = error.status >= 400 && error.status <= 599 ? error.status : 502
      return c.json({ error: error.message }, status as 502)
    }
    return c.json({ error: 'unexpected failure', detail: String(error) }, 500)
  })

  app.route('/api', createApi(deps))
  return app
}

export type { AppDeps }
