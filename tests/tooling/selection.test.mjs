import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { selectTests, changedFiles } from '../lib/affected.mjs'
import { parseOptions } from '../lib/runner-options.mjs'
import { root } from '../lib/execution.mjs'

test('empty diff runs nothing', () => assert.deepEqual(selectTests(root, []).actions, []))
test('logic and UI tests select their own project', () => {
  const result = selectTests(root, ['apps/web/lib/health.ts', 'apps/web/tests/ui/settings-users.test.tsx'])
  assert.ok(result.actions.some((a) => a.project === 'logic' && a.filter === 'tests/logic/health.test.ts'))
  assert.ok(result.actions.some((a) => a.project === 'ui' && a.filter === 'tests/ui/settings-users.test.tsx'))
})
test('shared source reaches downstream workspaces and deduplicates', () => {
  const result = selectTests(root, ['packages/core/src/health.ts', 'apps/web/lib/health.ts'])
  assert.ok(result.actions.some((a) => a.workspace === 'portta-web' && !a.filter))
  assert.ok(!result.actions.some((a) => a.workspace === 'portta-web' && a.filter))
})
test('removed or unmatched test falls back to its workspace', () => {
  assert.ok(selectTests(root, ['packages/db/tests/removed.test.ts']).actions.some((a) => a.workspace === 'portta-db' && !a.filter))
})
test('schema selects generation check; routes select OpenAPI', () => {
  const result = selectTests(root, ['packages/db/src/schema/tasks.ts', 'packages/server/src/api/routes/tasks.ts'])
  assert.ok(result.actions.some((a) => a.command?.includes('db:check')))
  assert.ok(result.actions.some((a) => a.command?.includes('openapi:check')))
})
test('unknown and global config paths produce gaps', () => {
  assert.equal(selectTests(root, ['unknown.file', 'package-lock.json']).gaps.length, 2)
})
test('E2E is advisory and never implicitly starts containers', () => {
  const result = selectTests(root, ['tests/e2e/apply.test.sh', 'apps/web/e2e/roles.spec.ts'])
  assert.equal(result.actions.length, 0)
  assert.equal(result.recommendations.length, 2)
})
test('documentation only checks links', () => {
  assert.equal(selectTests(root, ['docs/testing.md']).actions.length, 1)
})
test('diff covers committed, staged, unstaged, removed, renamed and new files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'portta-diff-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  try {
    git('init', '-q'); git('config', 'user.email', 'test@example.test'); git('config', 'user.name', 'Test')
    for (const name of ['old', 'removed', 'dirty', 'committed']) writeFileSync(join(dir, name), 'original')
    git('add', '.'); git('commit', '-qm', 'baseline'); git('branch', 'baseline')
    writeFileSync(join(dir, 'committed'), 'new'); git('commit', '-qam', 'change')
    renameSync(join(dir, 'old'), join(dir, 'renamed')); git('add', '-A')
    rmSync(join(dir, 'removed')); writeFileSync(join(dir, 'dirty'), 'new'); writeFileSync(join(dir, 'new'), 'new')
    assert.deepEqual(changedFiles(dir, 'baseline'), ['committed', 'dirty', 'new', 'old', 'removed', 'renamed'])
    assert.ok(!changedFiles(dir).includes('committed'))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
test('runner rejects ambiguous modes and ignored selectors', () => {
  for (const args of [['--unit', '--lint'], ['--e2e', '--spec'], ['--unit', '--spec', 'x'], ['--e2e', '--suite', 'x', '--spec', 'y'], ['--nonsense']]) assert.throws(() => parseOptions(args))
  assert.equal(parseOptions(['--e2e', '--suite', 'lifecycle']).suite, 'lifecycle')
  assert.equal(parseOptions([]).mode, 'integration')
})


test('CI keeps cosmetic components out of browser regression and gates releases fully', async () => {
  const { ciScope } = await import('../lib/ci-scope.mjs')
  assert.deepEqual(ciScope(['apps/web/components/ui/button.tsx']).browser, [])
  assert.equal(ciScope(['docs/testing.md']).code, false)
  assert.ok(ciScope(['packages/auth/src/bootstrap.ts']).browser.includes('roles'))
  assert.equal(ciScope([], true).gateway.length, 8)
  assert.equal(ciScope([], true).browser.length, 6)
})
