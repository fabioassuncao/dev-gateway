import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { root, runStep, reportDir } from './lib/execution.mjs'
import { parseOptions } from './lib/runner-options.mjs'

const options = parseOptions(process.argv.slice(2))
if (options.mode === 'help') {
  console.log(`Portta validation (Node 22.12+ required)
  --integration / no args  static checks, shell, workspaces, types, OpenAPI, schema
  --lint                  static checks including Compose; no containers
  --compose [--profile NAME] [--template FILE.yaml]
  --unit                  legacy shell + workspaces + types + OpenAPI + schema
  --e2e [--suite NAME | --spec FILE.spec.ts]  isolated gateway/browser only
  --release / --all       integration + build + isolated gateway/browser E2E
  --fast                  deprecated alias for integration
Use npm test --workspace=NAME -- path/to/file.test.ts for ordinary development.`)
  process.exit(0)
}
for (const notice of options.notices) console.log(notice)
let passed = true
async function step(label, command, args, extra) {
  const ok = await runStep(label, command, args, extra)
  passed = ok && passed
  return ok
}
const ws = ['portta-core', 'portta-contracts', 'portta-db', 'portta-auth-core', 'portta', 'portta-auth', 'portta-server', 'portta-web']
if (['integration', 'release', 'unit'].includes(options.mode)) {
  if (!existsSync(join(root, 'node_modules'))) throw new Error('node_modules missing: run npm ci')
  for (const [command, args] of [['docker', ['compose', 'version']], ['cloudflared', ['--version']]]) {
    if (!await step(`required tool ${command}`, command, args)) process.exit(1)
  }
  // Shell parity and shipped-entrypoint smoke must use this checkout's output.
  for (const name of ['portta-core', 'portta']) {
    if (!await step(`build prerequisite ${name}`, 'npm', ['run', 'build', `--workspace=${name}`])) process.exit(1)
  }
}
if (['integration', 'release', 'lint'].includes(options.mode)) await step('static checks', 'bash', ['tests/lint.sh'])
if (options.mode === 'compose') {
  if (!options.template) await step('profiles', 'bash', ['tests/unit/profiles.test.sh', ...(options.profile ? ['--profile', options.profile] : [])])
  if (!options.profile) await step('templates', 'bash', ['tests/unit/templates.test.sh', ...(options.template ? ['--template', options.template] : [])])
}
if (['integration', 'release', 'unit'].includes(options.mode)) {
  await step('test tooling', 'npm', ['run', 'test:tooling'])
  for (const file of readdirSync(join(root, 'tests/unit')).filter((file) => file.endsWith('.test.sh')).sort()) await step(file, 'bash', [`tests/unit/${file}`])
  for (const name of ws) await step(name, 'npm', ['test', `--workspace=${name}`, '--'], { vitest: true })
  for (const name of ws) await step(`types ${name}`, 'npm', ['run', 'typecheck', `--workspace=${name}`])
  await step('OpenAPI', 'npm', ['run', 'openapi:check', '--workspace=portta-contracts'])
  await step('schema', 'npm', ['run', 'db:check', '--workspace=portta-db'])
}
if (['e2e', 'release'].includes(options.mode) && passed) {
  if (!options.spec) await step('gateway E2E', process.execPath, ['tests/gateway-e2e.mjs', ...(options.suite ? ['--suite', options.suite] : [])])
  if (!options.suite) await step('browser E2E', 'npm', ['run', 'test:e2e', '--workspace=portta-web', '--', ...(options.spec ? [options.spec] : [])])
}
console.log(`\n${passed ? 'Selected validation passed; see reports for conditional skips.' : 'Validation failed.'}\nReports: ${reportDir}`)
process.exitCode = passed ? 0 : 1
