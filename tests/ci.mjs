import { appendFileSync } from 'node:fs'
import { changedFiles } from './lib/affected.mjs'
import { ciScope } from './lib/ci-scope.mjs'
import { root, runStep } from './lib/execution.mjs'

const release = process.env.PORTTA_CI_RELEASE === 'true'
const base = process.env.PORTTA_CI_BASE
const scope = ciScope(base && !/^0+$/.test(base) ? changedFiles(root, base) : ['tests/run.mjs', 'apps/web/playwright.config.ts'], release)
console.log(JSON.stringify(scope, null, 2))
if (process.argv[2] === '--scope') {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `code=${scope.code}\nbrowser=${scope.browser.length > 0}\n`)
} else {
  let passed = true
  // One disposable host invocation for the selected gateway suites, one build
  // for all selected browser specs. No repeat integration run here.
  if (scope.gateway.length) passed = await runStep('gateway CI', process.execPath, ['tests/gateway-e2e.mjs', '--suites', scope.gateway.join(',')]) && passed
  if (scope.browser.length) passed = await runStep('browser CI', 'npm', ['run', 'test:e2e', '--workspace=portta-web', '--', ...scope.browser.map((s) => `${s}.spec.ts`)]) && passed
  process.exitCode = passed ? 0 : 1
}
