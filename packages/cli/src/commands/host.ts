import type { Command } from 'commander'
import { STALE_AFTER_SECONDS } from 'portta-core'
import { gatewayContext } from '../context.js'
import { collectSnapshot } from '../metrics/collect.js'
import { collectorRunning, runCollectorLoop, startCollector, stopCollector } from '../metrics/lifecycle.js'
import { currentFile } from '../metrics/paths.js'
import { readCurrent, writeCurrent } from '../metrics/store.js'
import { Output } from '../output.js'

function globals(command: Command) {
  return command.optsWithGlobals() as {
    json?: boolean
    yes?: boolean
    quiet?: boolean
    verbose?: boolean
    profile?: string
    loop?: boolean
  }
}

export async function collectHostResources(root: string): Promise<string> {
  const snapshot = await collectSnapshot(root)
  return writeCurrent(root, snapshot)
}

export async function ensureMetricsCollector(profile: string | undefined, output: Output): Promise<void> {
  try {
    const context = gatewayContext({ profile })
    const { pid, started } = startCollector(context.root)
    if (started) output.progress(`host metrics collector started (pid ${pid})`)
  } catch (error) {
    output.warning(`Host metrics collector could not start: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function stopMetricsCollector(profile: string | undefined, output: Output): void {
  try {
    const context = gatewayContext({ profile, required: false })
    if (stopCollector(context.root)) output.progress('host metrics collector stopped')
  } catch {
    // down still succeeds if the collector was already gone
  }
}

export async function hostCollect(command: Command): Promise<void> {
  const context = gatewayContext({ profile: globals(command).profile })
  const target = await collectHostResources(context.root)
  const output = new Output(globals(command))
  if (output.json) {
    output.data({ file: target, collected: true })
    return
  }
  output.progress(`wrote ${target}`)
}

export async function hostWatch(command: Command): Promise<void> {
  const options = globals(command)
  const context = gatewayContext({ profile: options.profile })
  if (options.loop) {
    await runCollectorLoop(context.root)
    return
  }
  const output = new Output(options)
  const { pid, started } = startCollector(context.root)
  if (output.json) {
    output.data({ pid, started, file: currentFile(context.root) })
    return
  }
  output.progress(started ? `host metrics collector started (pid ${pid})` : `host metrics collector already running (pid ${pid})`)
}

export async function hostStatus(command: Command): Promise<void> {
  const options = globals(command)
  const context = gatewayContext({ profile: options.profile })
  const pid = collectorRunning(context.root)
  const snapshot = readCurrent(context.root)
  const now = Math.floor(Date.now() / 1000)
  const ageSeconds = snapshot ? Math.max(0, now - snapshot.collectedAt) : null
  const stale = ageSeconds !== null && ageSeconds > STALE_AFTER_SECONDS
  const payload = {
    running: pid !== null,
    pid,
    collectedAt: snapshot?.collectedAt ?? null,
    ageSeconds,
    stale,
    file: currentFile(context.root),
  }
  const output = new Output(options)
  if (output.json) {
    output.data(payload)
    return
  }
  if (pid === null) output.line('collector: stopped')
  else output.line(`collector: running (pid ${pid})`)
  if (ageSeconds === null) output.line('last collect: never')
  else output.line(`last collect: ${ageSeconds}s ago${stale ? ' (stale)' : ''}`)
}
