// Executed only inside the newly created disposable host.
import { execFileSync } from 'node:child_process'
import { cpSync, writeFileSync, readFileSync } from 'node:fs'
import { runStep } from '../lib/execution.mjs'

if (process.cwd() !== '/work' || readFileSync('/proc/1/comm', 'utf8').trim() !== 'dockerd') throw new Error('This entrypoint runs only inside the disposable Docker host')

const id = execFileSync('docker', ['info', '--format', '{{.ID}}'], { encoding: 'utf8' }).trim()
writeFileSync('/run/portta-e2e-owner.json', JSON.stringify({ id, root: '/work' }))
for (const args of [['init', '-q'], ['config', 'user.email', 'e2e@example.test'], ['config', 'user.name', 'E2E'], ['add', '.'], ['commit', '-qm', 'Disposable test source']]) execFileSync('git', args)
cpSync('.env.example', '.env')
if (!await runStep('install dependencies', 'npm', ['ci'])) process.exit(1)
for (const name of ['portta-core', 'portta-contracts', 'portta-db', 'portta-auth-core', 'portta', 'portta-auth', 'portta-server', 'portta-web']) {
  if (!await runStep(`build ${name}`, 'npm', ['run', 'build', `--workspace=${name}`])) process.exit(1)
}
if (!await runStep('gateway build', 'bin/portta', ['build'])) process.exit(1)
let passed = true
for (const name of process.argv.slice(2)) {
  passed = await runStep(`gateway ${name}`, 'bash', [`tests/e2e/${name}.test.sh`]) && passed
}
process.exitCode = passed ? 0 : 1
