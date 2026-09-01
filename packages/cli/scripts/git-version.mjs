import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(packageDir, '../..')
const pkg = JSON.parse(readFileSync(resolve(packageDir, 'package.json'), 'utf8'))
const version = readFileSync(resolve(root, 'VERSION'), 'utf8').trim()

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

const action = process.argv[2]
if (action === 'check') {
  if (pkg.version !== version) throw new Error(`package version ${pkg.version} does not match VERSION ${version}`)
  if (git('status', '--porcelain')) throw new Error('refusing to version a dirty worktree')
} else if (action === 'sync') {
  writeFileSync(resolve(root, 'VERSION'), `${pkg.version}\n`)
  execFileSync('npm', ['run', 'openapi', '--workspace=portta-web'], { cwd: root, stdio: 'inherit' })
  execFileSync('git', ['add', 'VERSION', 'apps/web/openapi.json', 'packages/cli/package.json', 'package-lock.json'], { cwd: root, stdio: 'inherit' })
} else if (action === 'verify') {
  const synced = readFileSync(resolve(root, 'VERSION'), 'utf8').trim()
  if (pkg.version !== synced) throw new Error(`package version ${pkg.version} does not match VERSION ${synced}`)
} else throw new Error('usage: git-version.mjs check|sync|verify')
