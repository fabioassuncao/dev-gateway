import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { composeFiles, loadGatewayConfig, mergeEnvironment, parseEnv, type GatewayConfig } from '@dev-gateway/core'
import { PreconditionError } from './errors.js'
import { CLI_VERSION } from './version.js'

export interface GatewayContext {
  root: string
  env: NodeJS.ProcessEnv
  config: GatewayConfig
  composeFiles: string[]
  version: string
}

// The compose files live under docker/compose/ (ADR 0019). A published CLI
// outlives the checkout it is pointed at in both directions, so both earlier
// layouts remain recognised as gateway roots rather than "not a checkout".
function isGatewayRoot(path: string): boolean {
  if (!existsSync(join(path, 'VERSION'))) return false
  return existsSync(join(path, 'docker', 'compose', 'compose.yaml'))
    || existsSync(join(path, 'docker', 'compose.yaml'))
    || existsSync(join(path, 'compose.yaml'))
}

export function findGatewayRoot(start = process.cwd()): string | null {
  const configured = process.env['DG_ROOT']
  if (configured && isGatewayRoot(resolve(configured))) return resolve(configured)
  let current = resolve(start)
  for (;;) {
    if (isGatewayRoot(current)) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

export function gatewayContext(options: { root?: string; profile?: string; required?: boolean } = {}): GatewayContext {
  const root = options.root ? resolve(options.root) : findGatewayRoot()
  if (!root) {
    if (options.required === false) {
      const env = { ...process.env, DEV_GATEWAY_PROFILE: options.profile ?? process.env['DEV_GATEWAY_PROFILE'] }
      const config = loadGatewayConfig(env)
      return { root: process.cwd(), env, config, composeFiles: [], version: CLI_VERSION }
    }
    throw new PreconditionError('this command needs a Dev Gateway checkout', 'run dev-gateway setup, or execute it inside the gateway directory')
  }
  const file = existsSync(join(root, '.env')) ? parseEnv(readFileSync(join(root, '.env'), 'utf8')) : new Map<string, string>()
  const env = mergeEnvironment(file, process.env)
  if (options.profile) env['DEV_GATEWAY_PROFILE'] = options.profile
  env['DG_ROOT'] = root
  const config = loadGatewayConfig(env)
  const files = composeFiles(config)
  for (const fileName of files) {
    if (!existsSync(join(root, fileName))) throw new PreconditionError(`missing compose file: ${fileName}`)
  }
  return {
    root,
    env,
    config,
    composeFiles: files,
    version: readFileSync(join(root, 'VERSION'), 'utf8').trim(),
  }
}

// --project-directory anchors every relative path in the overlays (./config,
// ./state, ./.env, and the build contexts) at the repository root. Without it
// Compose would resolve them against docker/compose/, where the first -f file lives.
export function composeArguments(context: GatewayContext): string[] {
  return ['--project-directory', context.root, ...context.composeFiles.flatMap((file) => ['-f', join(context.root, file)])]
}
