// Preparing the project runner, from the TypeScript CLI.
//
// The argument list lives in portta-core. Everything here is the
// reconciliation around it. See ADR 0030.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  RUNNER_CONTAINER,
  RUNNER_IMAGE,
  isTrue,
  runnerCreateArguments,
  runnerRefusal,
  runnerSpec,
} from 'portta-core'
import type { GatewayContext } from '../context.js'
import { runProcess } from '../process.js'

export type RunnerOutcome =
  | { action: 'kept' | 'created' | 'removed' | 'absent' }
  | { action: 'refused'; reason: string }
  | { action: 'failed'; reason: string }

async function label(name: string): Promise<string | null> {
  const result = await runProcess(
    'docker',
    ['container', 'inspect', RUNNER_CONTAINER, '--format', `{{ index .Config.Labels "${name}" }}`],
    { reject: false },
  )
  return result.exitCode === 0 ? result.stdout.trim() : null
}

async function state(): Promise<string | null> {
  const result = await runProcess(
    'docker',
    ['container', 'inspect', RUNNER_CONTAINER, '--format', '{{ .State.Status }}'],
    { reject: false },
  )
  return result.exitCode === 0 ? result.stdout.trim() : null
}

export async function removeRunner(): Promise<boolean> {
  if ((await label('portta.managed')) !== 'true') return false
  if ((await state()) === 'running') return false
  const result = await runProcess('docker', ['rm', '-f', RUNNER_CONTAINER], { reject: false })
  return result.exitCode === 0
}

export async function ensureRunner(context: GatewayContext): Promise<RunnerOutcome> {
  const exists = (await label('portta.component')) === 'runner'

  if (!isTrue(context.env['PORTTA_RUNNER'] ?? 'false')) {
    if (!exists) return { action: 'absent' }
    return (await removeRunner()) ? { action: 'removed' } : { action: 'absent' }
  }

  const refusal = runnerRefusal(context.env)
  if (refusal !== null) {
    if (exists) await removeRunner()
    return { action: 'refused', reason: refusal }
  }

  const spec = runnerSpec(context.root, context.version)
  if (exists) {
    if ((await label('portta.runner.spec')) === spec) return { action: 'kept' }
    if (!(await removeRunner())) return { action: 'failed', reason: 'the running runner could not be replaced' }
  }

  const context_dir = join(context.root, 'docker', 'images', 'apply')
  if (!existsSync(join(context_dir, 'Dockerfile'))) {
    return { action: 'failed', reason: `no runner image source at ${context_dir}` }
  }
  const present = await runProcess('docker', ['image', 'inspect', RUNNER_IMAGE], { reject: false })
  if (present.exitCode !== 0) {
    // RUNNER_IMAGE is APPLY_IMAGE (packages/core/src/runner.ts); tagged by the
    // name this file inspected, so the two lines read as the same image.
    const built = await runProcess('docker', ['build', '-t', RUNNER_IMAGE, context_dir], { reject: false, stdio: 'stream' })
    if (built.exitCode !== 0) return { action: 'failed', reason: `could not build ${RUNNER_IMAGE}` }
  }

  const created = await runProcess('docker', runnerCreateArguments(context.root, spec), { reject: false })
  return created.exitCode === 0
    ? { action: 'created' }
    : { action: 'failed', reason: created.stderr.trim() || 'docker create failed' }
}
