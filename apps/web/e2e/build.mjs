import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

export default function build() {
  const root = resolve(import.meta.dirname, '../../..')
  const lock = resolve(root, 'apps/web/.e2e-build-lock')
  try { mkdirSync(lock) } catch { throw new Error('Another E2E build holds apps/web/.e2e-build-lock; refusing concurrent writes. Remove it only after verifying its owner exited.') }
  const start = performance.now()
  try {
    for (const workspace of ['portta-core', 'portta-contracts', 'portta-db', 'portta-auth-core', 'portta-server', 'portta', 'portta-web']) {
      execFileSync('npm', ['run', 'build', `--workspace=${workspace}`], { cwd: root, stdio: 'inherit' })
    }
  } finally { rmSync(lock, { recursive: true }) }
  console.log(`E2E build: ${((performance.now() - start) / 1000).toFixed(3)}s`)
}
