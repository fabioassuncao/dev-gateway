import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The UI is a plain SPA. In production it is built once and served by the Hono
// server, so there is a single endpoint for the user; in development Vite owns
// the port, proxies /api to the server running beside it, and proxies /docs
// to the documentation Vite that `dev:ui` starts on 5174.
//
// cacheDir is namespaced: `dev:ui` runs this Vite beside the docs one, and
// Vite's default (nearest package.json → node_modules/.vite/deps) is shared.
// Distinct roots produce distinct config hashes, so one process would delete
// the other's pre-bundle and the browser would get 504 Outdated Optimize Dep.
export default defineConfig({
  root: 'src/ui',
  cacheDir: resolve(import.meta.dirname, 'node_modules/.vite/ui'),
  optimizeDeps: {
    include: ['i18next', 'react-i18next'],
  },
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../../dist/ui',
    emptyOutDir: true,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.PORTTA_RUNTIME_API_TARGET ?? 'http://127.0.0.1:8081',
        changeOrigin: false,
      },
      '/docs': {
        target: 'http://127.0.0.1:5174',
        changeOrigin: false,
      },
    },
  },
})
