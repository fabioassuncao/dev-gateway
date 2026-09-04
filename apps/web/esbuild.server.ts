// The entry point, bundled.
//
// `packages: 'external'` keeps every dependency out of the bundle: the runtime
// image installs them, Next needs its own files on disk, and the database
// driver opens sockets a bundler cannot follow. What this produces is one
// module that resolves the workspace packages' `dist/` — which is why the image
// builds them first.

import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

await build({
  entryPoints: [`${root}server/main.ts`],
  outfile: `${root}dist/server.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
})
