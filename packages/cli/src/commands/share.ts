import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readEnvFile, renderShares, SHARES_MARKER, writeEnvFile } from '@dev-gateway/core'
import type { Command } from 'commander'
import { z } from 'zod'
import { gatewayContext } from '../context.js'
import { UsageError } from '../errors.js'
import { Output } from '../output.js'

const Share = z.object({ id: z.string(), mode: z.enum(['public', 'protected']), host: z.string(), entryPoint: z.string(), container: z.string(), port: z.number(), expiresAt: z.number(), user: z.string().nullable().optional(), hash: z.string().nullable().optional() }).passthrough()
type Share = z.infer<typeof Share>
function globals(command: Command) { return command.optsWithGlobals() as { json?: boolean; yes?: boolean; quiet?: boolean; verbose?: boolean; profile?: string } }
function path(command: Command): string { return join(gatewayContext({ profile: globals(command).profile }).root, 'config/traefik/dynamic/dev-gateway-shares.yaml') }
function read(command: Command): Share[] {
  const file = path(command)
  if (!existsSync(file)) return []
  const line = readEnvFile(file).split('\n').find((candidate) => candidate.startsWith(SHARES_MARKER))
  return line ? z.array(Share).parse(JSON.parse(line.slice(SHARES_MARKER.length))) : []
}
function write(command: Command, shares: Share[]): void { writeEnvFile(path(command), renderShares(shares)) }

export async function shareList(command: Command): Promise<void> {
  const shares = read(command)
  const output = new Output(globals(command))
  if (output.json) output.data({ shares })
  else if (!shares.length) output.progress('nothing is shared')
  else for (const share of shares) output.line(`${share.id}\t${share.mode}\t${share.host}\t${share.container}:${share.port}\t${share.expiresAt}`)
}
export async function shareRevoke(id: string, command: Command): Promise<void> {
  if (!/^[A-Za-z0-9]+$/.test(id)) throw new UsageError(`invalid share id: ${id}`)
  const shares = read(command)
  if (!shares.some((share) => share.id === id)) throw new UsageError(`no share ${id}`)
  write(command, shares.filter((share) => share.id !== id))
  new Output(globals(command)).progress(`share ${id} revoked; the project router was not touched`)
}
export async function shareGc(command: Command): Promise<void> {
  const shares = read(command); const now = Math.floor(Date.now() / 1000); const kept = shares.filter((share) => share.expiresAt > now)
  if (kept.length !== shares.length) write(command, kept)
  new Output(globals(command)).progress(`removed ${shares.length - kept.length} expired share(s)`)
}

export { renderShares }
