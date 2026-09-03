import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { AppDeps } from './deps.ts'
import type { LiveEvent } from '../../shared/types.ts'
import { documentRoute, eventStreamResponse } from '../openapi.ts'

const KEEPALIVE_MS = 20_000

export function eventRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  // Server-sent events, not a WebSocket: the traffic is one-way and the
  // browser reconnects on its own.
  app.get('/events', documentRoute({
    tag: 'Events', operationId: 'streamEvents', capability: 'gateway:read', summary: 'Stream runtime events',
    description: 'Server-sent events. Each non-ping data frame is a JSON LiveEvent; clients reconnect normally.',
    response: eventStreamResponse, mediaType: 'text/event-stream', responseDescription: 'An open SSE stream.',
    errors: [500, 502],
  }), (c) =>
    streamSSE(c, async (stream) => {
      const pending: LiveEvent[] = []
      let wake: (() => void) | null = null
      let active = true

      const unsubscribe = deps.hub.subscribe((event) => {
        pending.push(event)
        wake?.()
      })

      stream.onAbort(() => {
        active = false
        unsubscribe()
        wake?.()
      })

      const hello: LiveEvent = {
        kind: 'hello',
        action: 'connected',
        id: null,
        name: null,
        project: null,
        ownership: null,
        at: Math.floor(Date.now() / 1000),
      }
      await stream.writeSSE({ event: 'hello', data: JSON.stringify(hello) })

      let lastKeepalive = Date.now()
      try {
        while (active) {
          while (pending.length > 0 && active) {
            const event = pending.shift()
            if (!event) break
            await stream.writeSSE({ event: event.kind, data: JSON.stringify(event) })
          }
          if (!active) break
          if (Date.now() - lastKeepalive >= KEEPALIVE_MS) {
            await stream.writeSSE({ event: 'ping', data: String(Math.floor(Date.now() / 1000)) })
            lastKeepalive = Date.now()
          }
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              wake = null
              resolve()
            }, 1000)
            wake = () => {
              clearTimeout(timer)
              wake = null
              resolve()
            }
          })
        }
      } finally {
        unsubscribe()
      }
    }),
  )

  return app
}
