import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startPostgres } from '../../apps/web/e2e/resources.mjs'

function engine() {
  const calls = [], labels = new Map()
  let mismatch = false, count = 0
  const command = (...args) => {
    calls.push(args)
    if (args[0] === 'network' && args[1] === 'create' || args[0] === 'run') {
      const id = `resource-${++count}`
      labels.set(id, args[args.indexOf('--label') + 1].split('=')[1])
      return id
    }
    if (args.includes('inspect')) return mismatch ? 'another-owner' : labels.get(args.at(-1))
    if (args[0] === 'port') return '127.0.0.1:15432'
    return ''
  }
  return { command, calls, changeOwner: () => { mismatch = true } }
}

test('database is unpublished and cleanup targets only acquired resources once', async () => {
  const docker = engine()
  const resource = await startPostgres({ command: docker.command })
  const runs = docker.calls.filter((args) => args[0] === 'run')
  assert.ok(!runs[0].includes('-p'))
  assert.equal(runs[1][runs[1].indexOf('-p') + 1], '127.0.0.1::5432')
  await resource.close()
  const before = docker.calls.length
  await resource.close()
  assert.equal(docker.calls.length, before)
  assert.deepEqual(docker.calls.filter((args) => args[0] === 'rm').map((args) => args.at(-1)), ['resource-3', 'resource-2'])
})
test('changed ownership prevents deletion', async () => {
  const docker = engine()
  const resource = await startPostgres({ command: docker.command })
  docker.changeOwner()
  await assert.rejects(resource.close(), /ownership changed/)
  assert.ok(!docker.calls.some((args) => args[0] === 'rm' || args[0] === 'network' && args[1] === 'rm'))
})
