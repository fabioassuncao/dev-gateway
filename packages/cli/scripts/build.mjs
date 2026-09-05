import { collectKnowledge, writeCorpus } from '../../../tooling/docs.mjs'
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
  alias: { 'portta-contracts': resolve(root, '../contracts/src/index.ts'), 'portta-core/browser': resolve(root, '../core/src/browser.ts'), 'portta-core': resolve(root, '../core/src/index.ts') },
  platform: 'node',
  format: 'esm',
  target: 'node22',
  conditions: ['development'],
  banner: { js: '#!/usr/bin/env node\nimport { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
  logLevel: 'info',
})

writeCorpus(collectKnowledge(), resolve(output, 'documentation.json'))
