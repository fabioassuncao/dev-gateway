// Serving the documentation the image carries.
//
// Two independent switches, because the two surfaces answer different
// questions. The guides are static text with no host information in them, so a
// routed panel may serve them; the API console issues real requests against
// this panel, so it keeps the conservative default it already had.
//
// Neither weakens authentication: when the panel is protected, Traefik's
// ForwardAuth runs before any of these paths is reached
// (docs/adr/0027-forward-authentication-service.md).

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { HTTPException } from 'hono/http-exception'
import type { PanelConfig } from '../config.ts'

/**
 * Mounted before the panel's own SPA static mount and its `*` catch-all, so a
 * deep link like `/docs/api` reaches the documentation shell rather than the
 * panel's index.
 */
export function registerDocsRoutes(app: Hono, config: PanelConfig): void {
  const index = join(config.docsDir, 'index.html')

  app.get('/docs', (c) => {
    if (!config.docs) throw new HTTPException(404, { message: 'the documentation is disabled' })
    return c.redirect('/docs/', 302)
  })

  app.use('/docs/*', async (_c, next) => {
    if (!config.docs) throw new HTTPException(404, { message: 'the documentation is disabled' })
    await next()
  })

  if (existsSync(index)) {
    app.use('/docs/*', serveStatic({ root: config.docsDir, rewriteRequestPath: (path) => path.replace(/^\/docs/, '') }))
    // Hash routing means only `/docs/` is ever requested, but a stray deep
    // link should land on the site rather than a 404 from the static mount.
    app.get('/docs/*', (c) => c.html(readFileSync(index, 'utf8')))
  } else {
    app.get('/docs/*', (c) =>
      c.text(
        'The documentation is not built in this image.\n' +
          'In development the UI Vite proxies /docs; run: npm run dev:ui --workspace=portta-web\n',
        200,
      ))
  }
}
