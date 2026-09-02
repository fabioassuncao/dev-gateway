import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
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
    // The screenshots `docs/web-ui.md` references. Copied rather than imported
    // so the Markdown keeps working on GitHub with the paths it already has.
    closeBundle() {
      const from = resolve(REPOSITORY_ROOT, '.github/images')
      const to = resolve(import.meta.dirname, 'dist/docs/images')
      if (!existsSync(from)) return
      mkdirSync(to, { recursive: true })
      cpSync(from, to, { recursive: true })
    },
  }
}

export default defineConfig({
  root: 'src/docs',
  base: '/docs/',
  plugins: [react(), tailwindcss(), porttaDocs()],
  build: {
    outDir: '../../dist/docs',
    emptyOutDir: true,
  },
})
