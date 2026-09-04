import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The login page a protected project hostname shows.
//
// It is a page, not an app: one form, no router, no query cache. Vite builds it
// because it has to be a static bundle the ForwardAuth service can serve from
// any origin — it cannot be a route of the panel, which is exactly the point.
export default defineConfig({
  root: resolve(import.meta.dirname, 'ui'),
  // Served under a path Traefik reserves, so it can never collide with a route
  // the protected project itself wants.
  base: '/__portta/auth/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve(import.meta.dirname, 'dist/ui'),
    emptyOutDir: true,
  },
})
