import { execFileSync } from 'node:child_process'
import { mkdtempSync, cpSync, mkdirSync, rmSync, existsSync, readdirSync, lstatSync, readlinkSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { root, runStep, reportDir } from './lib/execution.mjs'

const args = process.argv.slice(2)
const names = readdirSync(join(root, 'tests/e2e')).filter((f) => f.endsWith('.test.sh')).map((f) => f.slice(0, -8))
if (args.length && (args.length !== 2 || !['--suite', '--suites'].includes(args[0]))) throw new Error('Expected --suite NAME or --suites NAME,NAME')
const suites = args.length ? args[1].split(',') : names.sort()
if (!suites.length || suites.some((suite) => !names.includes(suite))) throw new Error(`Unknown suite; choose ${names.join(', ')}`)
const owner = randomUUID(), name = `portta-e2e-host-${owner}`
const image = `portta-e2e-host:${owner}`
const temporary = mkdtempSync(join(tmpdir(), 'portta-e2e-source-'))
const docker = (...arguments_) => execFileSync('docker', arguments_, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
let container
let interrupted = false
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { interrupted = true })
try {
  // Copy source, including the current diff, but never local credentials/state
  // or caches. The inner daemon sees only this disposable checkout.
  const files = dockerSourceFiles()
  for (const file of files) {
    const source = join(root, file)
    if (!existsSync(source)) continue
    mkdirSync(dirname(join(temporary, file)), { recursive: true })
    if (lstatSync(source).isSymbolicLink()) symlinkSync(readlinkSync(source), join(temporary, file))
    else cpSync(source, join(temporary, file), { dereference: false })
  }
  if (!await runStep('disposable host image', 'docker', ['build', '-t', image, 'tests/docker'])) throw new Error('E2E host build failed')
  if (interrupted) throw new Error('Interrupted before E2E startup')
  container = docker('create', '--privileged', '--name', name, '--label', `portta.e2e.run=${owner}`, image)
  docker('cp', `${temporary}/.`, `${container}:/work`)
  docker('start', container)
  let ready = false
  for (let i = 0; i < 120; i++) {
    if (interrupted) throw new Error('Interrupted during E2E startup')
    try { docker('exec', container, 'docker', 'info'); ready = true; break } catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  if (!ready) throw new Error('Disposable daemon failed to start')
  if (!await runStep('gateway environment and suites', 'docker', ['exec', container, 'node', 'tests/docker/run.mjs', ...suites])) process.exitCode = 1
} finally {
  const cleanupStarted = performance.now()
  if (container) {
    mkdirSync(reportDir, { recursive: true })
    try { docker('cp', `${container}:/work/test-results`, join(reportDir, 'gateway')) } catch { /* startup may have failed before reports */ }
    if (docker('inspect', '-f', '{{index .Config.Labels "portta.e2e.run"}}', container) !== owner) throw new Error('Refusing to remove a host whose ownership changed')
    // -v removes only the anonymous data volume created with this container.
    docker('rm', '-f', '-v', container)
  }
  rmSync(temporary, { recursive: true, force: true })
  try { docker('image', 'rm', image) } catch { /* image build may not have completed */ }
  console.log(`E2E owned host teardown: ${((performance.now() - cleanupStarted) / 1000).toFixed(3)}s`)
}

function dockerSourceFiles() {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0')
    .filter((file) => file && !/^(docs\/research\/|\.env$|state\/|config\/tls\/|config\/traefik\/dynamic\/)/.test(file))
}
