import { createReadStream, cpSync, existsSync, mkdirSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { collectDocs } from './src/docs/collect.ts'

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../..')

/**
 * The documentation, read at build time and handed to the app as one module.
 *
 * This is what makes the site offline: the panel image carries the rendered
 * corpus, so nothing is fetched, nothing is parsed at runtime, and no Markdown
 * dependency reaches the panel's production tree.
 *
 * `collectDocs` throws on a link that meant to reach a documentation page and
 * named one that does not exist, so this build is also the link checker the
 * repository did not have.
 */
function porttaDocs(): Plugin {
  const id = 'virtual:portta-docs'
  const resolved = `\0${id}`
  return {
    name: 'portta-docs',
    resolveId: (source) => (source === id ? resolved : null),
    load: (source) => (source === resolved ? `export default ${JSON.stringify(collectDocs(REPOSITORY_ROOT))}` : null),
    // In development the screenshots live on the host bind-mount; the built
    // image copies them next to the bundle instead.
    configureServer(server) {
      const from = resolve(REPOSITORY_ROOT, 'docs/images')
      const types: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
      }
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0] ?? ''
        if (!path.startsWith('/docs/images/')) return next()
        const name = basename(path)
        if (name !== path.slice('/docs/images/'.length)) return next()
        const file = join(from, name)
        if (!existsSync(file)) return next()
        res.setHeader('Content-Type', types[extname(name)] ?? 'application/octet-stream')
        createReadStream(file).pipe(res)
      })
    },
    // The screenshots next to the Markdown. Copied rather than imported so
    // GitHub and the site keep the same files.
    closeBundle() {
      const from = resolve(REPOSITORY_ROOT, 'docs/images')
      const to = resolve(import.meta.dirname, 'dist/docs/images')
      if (!existsSync(from)) return
      mkdirSync(to, { recursive: true })
      cpSync(from, to, { recursive: true })
    },
  }
}

export default defineConfig({
  root: 'src/docs',
  cacheDir: resolve(import.meta.dirname, 'node_modules/.vite/docs'),
  base: '/docs/',
  plugins: [react(), tailwindcss(), porttaDocs()],
  build: {
    outDir: '../../dist/docs',
    emptyOutDir: true,
  },
  // Bound to loopback inside the UI container. The panel Vite proxies /docs
  // here; HMR is off so nothing has to publish this port on the host.
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    hmr: false,
  },
})
