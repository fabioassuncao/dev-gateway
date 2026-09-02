import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Command } from 'commander'
import { gatewayContext } from '../context.js'
import { collectHostSnapshot } from '../host.js'
import { Output } from '../output.js'

function globals(command: Command) {
  return command.optsWithGlobals() as { json?: boolean; yes?: boolean; quiet?: boolean; verbose?: boolean; profile?: string }
}

export function hostFileFor(root: string): string {
  return join(root, 'state/host/host.json')
}

function writeCollected(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true })
  const temporary = `${path}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, path)
  chmodSync(path, 0o600)
}

export async function collectHostResources(root: string): Promise<string> {
  const snapshot = await collectHostSnapshot(root)
  const target = hostFileFor(root)
  writeCollected(target, snapshot)
  return target
}

export async function refreshHostResources(profile: string | undefined, output: Output): Promise<void> {
  try {
    const context = gatewayContext({ profile })
    await collectHostResources(context.root)
  } catch (error) {
    output.warning(`Host resources could not be collected: ${error instanceof Error ? error.message : String(error)}`)
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
