// Preparing the applier, from the TypeScript CLI.
//
// The argument list itself lives in portta-core, next to composeFiles, because
// scripts/lib/apply.sh has to build the same one without Node (ADR 0015).
// Everything here is the reconciliation around it. See ADR 0026 for why the
// applier exists and why it is not a Compose service.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { APPLY_CONTAINER, APPLY_IMAGE, applyCreateArguments, applyRefusal, applySpec, isTrue } from 'portta-core'
import type { GatewayContext } from '../context.js'
import { runProcess } from '../process.js'

export type ApplierOutcome =
  | { action: 'kept' | 'created' | 'removed' | 'absent' }
  | { action: 'refused'; reason: string }
  | { action: 'failed'; reason: string }

async function label(name: string): Promise<string | null> {
  const result = await runProcess(
    'docker',
    ['container', 'inspect', APPLY_CONTAINER, '--format', `{{ index .Config.Labels "${name}" }}`],
    { reject: false },
  )
  return result.exitCode === 0 ? result.stdout.trim() : null
}

async function state(): Promise<string | null> {
  const result = await runProcess(
    'docker',
    ['container', 'inspect', APPLY_CONTAINER, '--format', '{{ .State.Status }}'],
    { reject: false },
  )
  return result.exitCode === 0 ? result.stdout.trim() : null
}

/** Only ever a container the gateway created, and never one that is applying. */
export async function removeApplier(): Promise<boolean> {
  if ((await label('portta.managed')) !== 'true') return false
  if ((await state()) === 'running') return false
  const result = await runProcess('docker', ['rm', '-f', APPLY_CONTAINER], { reject: false })
  return result.exitCode === 0
}

/**
 * Reconcile the applier with PORTTA_APPLY. Never throws: a gateway that started
 * must not be reported as failed because an optional convenience could not be
 * prepared.
 */
export async function ensureApplier(context: GatewayContext): Promise<ApplierOutcome> {
  const exists = (await label('portta.component')) === 'apply'

  if (!isTrue(context.env['PORTTA_APPLY'] ?? 'false')) {
    if (!exists) return { action: 'absent' }
    return (await removeApplier()) ? { action: 'removed' } : { action: 'absent' }
  }

  const refusal = applyRefusal(context.env)
  if (refusal !== null) {
    if (exists) await removeApplier()
    return { action: 'refused', reason: refusal }
  }

  const spec = applySpec(context.root, context.version)
  if (exists) {
    if ((await label('portta.apply.spec')) === spec) return { action: 'kept' }
    if (!(await removeApplier())) return { action: 'failed', reason: 'the running applier could not be replaced' }
  }

  const context_dir = join(context.root, 'docker', 'images', 'apply')
  if (!existsSync(join(context_dir, 'Dockerfile'))) {
    return { action: 'failed', reason: `no applier image source at ${context_dir}` }
  }
  const present = await runProcess('docker', ['image', 'inspect', APPLY_IMAGE], { reject: false })
  if (present.exitCode !== 0) {
    const built = await runProcess('docker', ['build', '-q', '-t', APPLY_IMAGE, context_dir], { reject: false })
    if (built.exitCode !== 0) return { action: 'failed', reason: `could not build ${APPLY_IMAGE}` }
  }

  const created = await runProcess('docker', applyCreateArguments(context.root, spec), { reject: false })
  return created.exitCode === 0
    ? { action: 'created' }
    : { action: 'failed', reason: created.stderr.trim() || 'docker create failed' }
}
