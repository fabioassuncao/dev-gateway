import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { projectsFor, routesFor } from '@dev-gateway/core'
import type { Command } from 'commander'
import { composeArguments, gatewayContext } from '../context.js'
import { ensureNetwork, inspectContainers, networkExists, requireDocker } from '../docker.js'
import { CliError, EXIT, RefusedError } from '../errors.js'
import { Output } from '../output.js'
import { runProcess } from '../process.js'
import { confirm } from '../confirm.js'

function globals(command: Command) {
  return command.optsWithGlobals() as { json?: boolean; yes?: boolean; quiet?: boolean; verbose?: boolean; profile?: string }
}

async function compose(command: Command, args: string[], stdio: 'inherit' | 'pipe' = 'inherit') {
  const options = globals(command)
  const context = gatewayContext({ profile: options.profile })
  return runProcess('docker', ['compose', ...composeArguments(context), ...args], { cwd: context.root, env: context.env, stdio })
}

export async function versionCommand(command: Command): Promise<void> {
  const context = gatewayContext({ required: false })
  new Output(globals(command)).data(`dev-gateway ${context.version}`)
}

export async function bootstrapCommand(options: { skipPull?: boolean }, command: Command): Promise<void> {
  const global = globals(command)
  const output = new Output(global)
  const context = gatewayContext({ profile: global.profile })
  await requireDocker()
  const composeVersion = await runProcess('docker', ['compose', 'version', '--short'], { reject: false })
  if (composeVersion.exitCode !== 0) throw new CliError('Docker Compose v2 is required', EXIT.precondition)
  if (!existsSync(join(context.root, '.env'))) {
    copyFileSync(join(context.root, '.env.example'), join(context.root, '.env'))
    output.progress('created  .env from .env.example')
  }
  for (const directory of ['state', 'state/git', 'config/tls', 'config/traefik/dynamic']) mkdirSync(join(context.root, directory), { recursive: true })
  const network = await ensureNetwork(context.config.network)
  output.progress(`${network.padEnd(8)} shared network ${context.config.network}`)
  if (!options.skipPull) await compose(command, ['pull'])
  await doctorCommand(command)
}

export async function upCommand(profile: string | undefined, options: { attach?: boolean }, command: Command): Promise<void> {
  if (profile) command.setOptionValueWithSource('profile', profile, 'cli')
  const context = gatewayContext({ profile: profile ?? globals(command).profile })
  if (context.config.profile === 'remote-public' && context.config.tcpEnabled) throw new RefusedError('TCP entrypoints must not run on the remote-public profile')
  if (context.config.profile === 'remote-public' && context.config.webEnabled && context.config.webExpose === 'vpn') throw new RefusedError('the panel must not be routed on the remote-public profile')
  await requireDocker()
  await ensureNetwork(context.config.network)
  await compose(command, ['up', options.attach ? '' : '-d', options.attach ? '' : '--remove-orphans'].filter(Boolean))
}

export async function downCommand(command: Command): Promise<void> { await compose(command, ['down']) }
export async function restartCommand(command: Command): Promise<void> { await compose(command, ['up', '-d', '--force-recreate']) }
export async function logsCommand(service: string | undefined, options: { follow?: boolean; tail?: string }, command: Command): Promise<void> {
  const global = globals(command)
  if (global.json) {
    const result = await compose(command, ['logs', '--no-color', '--no-log-prefix', '--tail', options.tail ?? '200', ...(service ? [service] : [])], 'pipe')
    new Output(global).data({ lines: result.stdout.split('\n').filter(Boolean) })
  } else await compose(command, ['logs', ...(options.follow === false ? [] : ['--follow']), '--tail', options.tail ?? '200', ...(service ? [service] : [])])
}

export async function updateCommand(command: Command): Promise<void> {
  await compose(command, ['config', '--quiet'])
  await compose(command, ['pull'])
  await confirm('recreate gateway components with the pulled images?', globals(command).yes === true)
  await compose(command, ['up', '-d', '--force-recreate'])
}

export async function inspectCommand(command: Command): Promise<void> {
  const options = globals(command)
  const context = gatewayContext({ profile: options.profile })
  const output = new Output(options)
  const secrets = new Set(['TS_AUTHKEY', 'CLOUDFLARE_API_TOKEN', 'DG_WEB_DB_PASSWORD', 'DEV_GATEWAY_WEB_AUTH_HASH'])
  const configuration = Object.fromEntries(Object.entries(context.env).filter(([key]) => key.startsWith('DEV_GATEWAY_') || ['TLS_ENABLED', 'TLS_MODE', 'PUBLIC_DOMAIN', 'PRIVATE_DOMAIN', 'TAILSCALE_ENABLED'].includes(key)).map(([key, value]) => [key, secrets.has(key) ? (value ? '<set>' : '<unset>') : value]))
  if (output.json) output.data({ profile: context.config.profile, configuration, composeFiles: context.composeFiles })
  else {
    output.line(`profile: ${context.config.profile}`)
    for (const [key, value] of Object.entries(configuration).sort()) output.line(`${key}=${value}`)
    output.line(`compose files: ${context.composeFiles.join(', ')}`)
  }
}

export async function statusCommand(command: Command): Promise<void> {
  const options = globals(command)
  const context = gatewayContext({ profile: options.profile })
  const containers = await inspectContainers()
  const routes = routesFor(containers, context.config.domain, context.config.tlsEnabled ? 'https' : 'http')
  const gateway = containers.filter((container) => container.labels['dev-gateway.managed'] === 'true')
  const status = {
    version: context.version,
    instance: { name: context.config.projectName },
    profile: context.config.profile,
    domain: context.config.domain,
    bindAddress: context.config.bindAddress,
    network: { name: context.config.network, exists: await networkExists(context.config.network) },
    components: gateway.map((container) => ({ name: container.name, state: container.state, component: container.labels['dev-gateway.component'] ?? null })),
    projectCount: projectsFor(containers, context.config.domain, context.config.tlsEnabled ? 'https' : 'http').length,
    routeCount: routes.length,
    tls: context.config.tlsEnabled,
    public: context.config.publicEnabled,
  }
  const output = new Output(options)
  if (output.json) output.data(status)
  else {
    output.line(`dev-gateway ${status.version} · ${status.profile} · ${status.domain}`)
    output.line(`network ${status.network.exists ? 'ready' : 'missing'} · ${status.components.length} components · ${status.routeCount} routes`)
    for (const component of status.components) output.line(`${component.component ?? component.name}\t${component.state}`)
  }
}

interface Check { id: string; status: 'pass' | 'fail'; message: string; fix?: string }

export async function doctorCommand(command: Command): Promise<void> {
  const options = globals(command)
  const context = gatewayContext({ profile: options.profile })
  const checks: Check[] = []
  const docker = await runProcess('docker', ['version', '--format', '{{.Server.Version}}'], { reject: false })
  checks.push(docker.exitCode === 0 ? { id: 'docker', status: 'pass', message: `Docker ${docker.stdout}` } : { id: 'docker', status: 'fail', message: 'Docker is unreachable', fix: 'start Docker or check DOCKER_HOST' })
  const composeVersion = await runProcess('docker', ['compose', 'version', '--short'], { reject: false })
  checks.push(composeVersion.exitCode === 0 ? { id: 'compose', status: 'pass', message: `Compose ${composeVersion.stdout}` } : { id: 'compose', status: 'fail', message: 'Compose v2 is unavailable', fix: 'install the Docker Compose plugin' })
  checks.push({ id: 'env', status: existsSync(join(context.root, '.env')) ? 'pass' : 'fail', message: existsSync(join(context.root, '.env')) ? '.env exists' : '.env is missing', fix: 'copy .env.example to .env' })
  if (docker.exitCode === 0) checks.push({ id: 'network', status: await networkExists(context.config.network) ? 'pass' : 'fail', message: `shared network ${context.config.network}`, fix: 'run dev-gateway bootstrap' })
  for (const file of context.composeFiles) checks.push({ id: `compose:${file}`, status: existsSync(join(context.root, file)) ? 'pass' : 'fail', message: `${file} exists` })
  const failed = checks.filter((check) => check.status === 'fail')
  const output = new Output(options)
  if (output.json) output.data({ ok: failed.length === 0, instance: { name: context.config.projectName }, checks })
  else for (const check of checks) {
    output.line(`${check.status === 'pass' ? 'ok  ' : 'FAIL'} ${check.message}`)
    if (check.fix) output.hint(check.fix)
  }
  if (failed.length) throw new CliError(`${failed.length} doctor check(s) failed`)
}

export async function urlsCommand(options: { project?: string }, command: Command): Promise<void> {
  const global = globals(command)
  const context = gatewayContext({ profile: global.profile })
  const routes = routesFor(await inspectContainers(), context.config.domain, context.config.tlsEnabled ? 'https' : 'http').filter((route) => !options.project || route.project === options.project)
  const output = new Output(global)
  if (output.json) output.data({ instance: { name: context.config.projectName }, routes, urls: routes })
  else for (const route of routes) output.line(`${route.url}\t${route.project ?? '-'}\t${route.service ?? route.container}`)
}
