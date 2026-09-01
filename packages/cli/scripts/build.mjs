import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { build } from 'esbuild'

const root = resolve(import.meta.dirname, '..')
const output = resolve(root, 'dist')
rmSync(output, { recursive: true, force: true })
mkdirSync(output, { recursive: true })

await build({
  entryPoints: [resolve(root, 'src/cli.ts')],
  outfile: resolve(output, 'cli.js'),
  bundle: true,
  packages: 'external',
  alias: { '@dev-gateway/core': resolve(root, '../core/src/index.ts') },
  platform: 'node',
  format: 'esm',
  target: 'node22',
  conditions: ['development'],
  banner: { js: '#!/usr/bin/env node\nimport { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
  logLevel: 'info',
})
