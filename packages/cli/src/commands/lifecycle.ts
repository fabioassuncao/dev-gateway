import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseAliases, projectsFor, routesFor, type StoredAlias } from 'portta-core'
import type { Command } from 'commander'
import { composeArguments, gatewayContext } from '../context.js'
import { ensureNetwork, inspectContainers, networkExists, requireDocker } from '../docker.js'
import { CliError, EXIT, RefusedError } from '../errors.js'
import { Output } from '../output.js'
import { runProcess } from '../process.js'
import { CLI_VERSION } from '../version.js'
import { confirm } from '../confirm.js'

function globals(command: Command) {
  return command.optsWithGlobals() as { json?: boolean; yes?: boolean; quiet?: boolean; verbose?: boolean; profile?: string }
}

async function compose(command: Command, args: string[], stdio: 'inherit' | 'pipe' = 'inherit') {
  const options = globals(command)
  const context = gatewayContext({ profile: options.profile })
  return runProcess('docker', ['compose', ...composeArguments(context), ...args], { cwd: context.root, env: context.env, stdio })
}

/** major.minor, which is the granularity the API contract moves at. */
function series(version: string): string {
  const parts = version.split('.')
  return `${parts[0] ?? '0'}.${parts[1] ?? '0'}`
}

/**
 * The panel's own version, read from the API it serves. Unauthenticated on
 * loopback and over the tailnet; behind BasicAuth in `public` mode, where a
 * 401 is a perfectly good answer to "is it there" and no answer at all to
 * "which version" — so that case reports the image tag instead, which is what
 * the installation pinned.
 */
async function panelReport(context: ReturnType<typeof gatewayContext>): Promise<{ version: string | null; detail: string }> {
  const image = context.env['PORTTA_WEB_IMAGE'] ?? ''
  const tag = image.includes(':') ? image.slice(image.lastIndexOf(':') + 1) : null
  if (!context.config.webEnabled) return { version: null, detail: 'disabled' }
  const host = context.config.webExpose === 'public' ? '127.0.0.1' : (context.env['PORTTA_WEB_BIND_ADDRESS'] ?? '127.0.0.1')
  try {
    const response = await fetch(`http://${host}:${context.config.webPort}/api/health`, { signal: AbortSignal.timeout(3000) })
    if (response.status === 401) return { version: tag, detail: tag ? `${tag} (from the image tag; the API is behind authentication)` : 'behind authentication' }
    if (!response.ok) return { version: tag, detail: `unreachable (HTTP ${response.status})` }
    const body = await response.json() as { panelVersion?: string }
    return { version: body.panelVersion ?? tag, detail: body.panelVersion ?? 'unknown' }
  } catch {
    return { version: tag, detail: tag ? `${tag} (from the image tag; the panel did not answer)` : 'not running' }
  }
}

export async function versionCommand(command: Command): Promise<void> {
  const global = globals(command)
  const output = new Output(global)
  const context = gatewayContext({ required: false })
  const cli = CLI_VERSION
  const gateway = context.version
  // A CLI installed from npm outlives the installation it is pointed at in
  // both directions, so it says which one it is talking to and whether the
  // two agree, rather than failing obscurely three commands later.
  const compatible = series(cli) === series(gateway)

  if (!output.json && !context.composeFiles.length) {
    output.data(`portta ${cli}`)
    return
  }

  const panel = await panelReport(context)
  if (output.json) {
    output.data({
      cli,
      gateway,
      panel: panel.version,
      root: context.root,
      compatible,
      apiSeries: series(gateway),
    })
    return
  }
  output.line(`portta ${cli}`)
  output.line(`  gateway  ${gateway}  (${context.root})`)
  output.line(`  panel    ${panel.detail}`)
  if (!compatible) {
    output.warning(`this CLI is ${cli} and the installation is ${gateway}`)
    output.hint('update the installation by re-running the installer, or install the matching CLI: npm i -g portta@' + gateway)
  }
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
  for (const directory of ['state', 'state/git', 'state/github', 'config/tls', 'config/traefik/dynamic']) mkdirSync(join(context.root, directory), { recursive: true })
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
  const secrets = new Set(['TS_AUTHKEY', 'CLOUDFLARE_API_TOKEN', 'PORTTA_RUNTIME_DB_PASSWORD', 'PORTTA_WEB_AUTH_HASH'])
  const configuration = Object.fromEntries(Object.entries(context.env).filter(([key]) => key.startsWith('PORTTA_') || ['TLS_ENABLED', 'TLS_MODE', 'PUBLIC_DOMAIN', 'PRIVATE_DOMAIN', 'TAILSCALE_ENABLED'].includes(key)).map(([key, value]) => [key, secrets.has(key) ? (value ? '<set>' : '<unset>') : value]))
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
  const gateway = containers.filter((container) => container.labels['portta.managed'] === 'true')
  const status = {
    version: context.version,
    instance: { name: context.config.projectName },
    profile: context.config.profile,
    domain: context.config.domain,
    bindAddress: context.config.bindAddress,
    network: { name: context.config.network, exists: await networkExists(context.config.network) },
    components: gateway.map((container) => ({ name: container.name, state: container.state, component: container.labels['portta.component'] ?? null })),
    projectCount: projectsFor(containers, context.config.domain, context.config.tlsEnabled ? 'https' : 'http').length,
    routeCount: routes.length,
    tls: context.config.tlsEnabled,
    public: context.config.publicEnabled,
  }
  const output = new Output(options)
  if (output.json) output.data(status)
  else {
    output.line(`portta ${status.version} · ${status.profile} · ${status.domain}`)
    output.line(`network ${status.network.exists ? 'ready' : 'missing'} · ${status.components.length} components · ${status.routeCount} routes`)
    for (const component of status.components) output.line(`${component.component ?? component.name}\t${component.state}`)
  }
}

// `warn` comes from the shell doctor, which distinguishes "worth knowing"
// from "broken": an absent GitHub CLI is not a reason to fail a run.
export interface Check { id: string; status: 'pass' | 'warn' | 'fail'; message: string; fix?: string }

/**
 * What `doctor` prints, as data.
 *
 * A fix belongs to a check that did not pass: printed under `ok` it reads as an
 * instruction to repair something that is already right.
 */
export function doctorReport(checks: Check[]): { line: string; hint?: string }[] {
  return checks.map((check) => ({
    line: `${check.status === 'pass' ? 'ok  ' : check.status === 'warn' ? 'warn' : 'FAIL'} ${check.message}`,
    ...(check.fix && check.status !== 'pass' ? { hint: check.fix } : {}),
  }))
}

/**
 * The deep diagnostics live in scripts/doctor.sh, which every checkout and
 * every PORTTA_HOME carries: the host, the runtime, exposure, the panel's
 * front door, the development toolchain and the AI agent CLIs. Running it here
 * rather than reimplementing a thinner version is what makes
 * `npx portta doctor` and `portta doctor` the same answer — ADR 0015 asks the
 * two surfaces to agree, and a second implementation could only drift.
 */
async function shellDoctor(root: string): Promise<Check[] | null> {
  const script = join(root, 'scripts/doctor.sh')
  if (!existsSync(script)) return null
  const result = await runProcess('bash', [script, '--json'], {
    cwd: root,
    env: { ...process.env, PORTTA_ROOT: root },
    reject: false,
  })
  if (!result.stdout.trim()) return null
  try {
    const parsed = JSON.parse(result.stdout) as { checks?: { id: string; status: string; title: string; detail: string; fix?: string }[] }
    return (parsed.checks ?? []).map((check) => ({
      id: check.id,
      status: check.status === 'fail' ? 'fail' : check.status === 'warn' ? 'warn' : 'pass',
      message: `${check.title}: ${check.detail}`,
      ...(check.fix ? { fix: check.fix } : {}),
    }))
  } catch {
    return null
  }
}

export async function doctorCommand(command: Command): Promise<void> {
  const options = globals(command)
  const context = gatewayContext({ profile: options.profile })
  const checks: Check[] = []
  const deep = await shellDoctor(context.root)
  if (deep) checks.push(...deep)
  const docker = await runProcess('docker', ['version', '--format', '{{.Server.Version}}'], { reject: false })
  // Everything below duplicates a check the shell doctor already made, so it
  // runs only when that could not: an installation whose scripts/ is missing,
  // or a bash that refused to produce JSON.
  if (!deep) {
    checks.push(docker.exitCode === 0 ? { id: 'docker', status: 'pass', message: `Docker ${docker.stdout}` } : { id: 'docker', status: 'fail', message: 'Docker is unreachable', fix: 'start Docker or check DOCKER_HOST' })
    const composeVersion = await runProcess('docker', ['compose', 'version', '--short'], { reject: false })
    checks.push(composeVersion.exitCode === 0 ? { id: 'compose', status: 'pass', message: `Compose ${composeVersion.stdout}` } : { id: 'compose', status: 'fail', message: 'Compose v2 is unavailable', fix: 'install the Docker Compose plugin' })
    checks.push({ id: 'env', status: existsSync(join(context.root, '.env')) ? 'pass' : 'fail', message: existsSync(join(context.root, '.env')) ? '.env exists' : '.env is missing', fix: 'copy .env.example to .env' })
    if (docker.exitCode === 0) checks.push({ id: 'network', status: await networkExists(context.config.network) ? 'pass' : 'fail', message: `shared network ${context.config.network}`, fix: 'run portta bootstrap' })
  }
  // Not duplicated: the shell doctor checks the files the shell selects, and a
  // published CLI can be pointed at an installation whose overlay set differs.
  for (const file of context.composeFiles) checks.push({ id: `compose:${file}`, status: existsSync(join(context.root, file)) ? 'pass' : 'fail', message: `${file} exists` })
  // An alias pins a container name, so a recreated environment leaves a router
  // pointing at nothing. Traefik reports no error for that; this does.
  const aliases = readAliases(context.root)
  if (aliases.length > 0) {
    const running = new Set((await inspectContainers()).map((container) => container.name))
    const dangling = aliases.filter((alias) => !running.has(alias.container))
    checks.push(dangling.length === 0
      ? { id: 'aliases', status: 'pass', message: `${aliases.length} hostname alias(es) routed` }
      : { id: 'aliases', status: 'fail', message: `alias target missing: ${dangling.map((alias) => `${alias.host} -> ${alias.container}`).join(', ')}`, fix: 'remove the alias in the panel, or start the environment again' })
  }
  const failed = checks.filter((check) => check.status === 'fail')
  const output = new Output(options)
  if (output.json) output.data({ ok: failed.length === 0, instance: { name: context.config.projectName }, checks })
  else for (const entry of doctorReport(checks)) {
    output.line(entry.line)
    if (entry.hint) output.hint(entry.hint)
  }
  if (failed.length) throw new CliError(`${failed.length} doctor check(s) failed`)
}

/**
 * Panel-created aliases live in a generated Traefik file, so the CLI can read
 * the same routing the panel wrote instead of disagreeing with it.
 */
export function readAliases(root: string): StoredAlias[] {
  const path = join(root, 'config/traefik/dynamic/portta-aliases.yaml')
  if (!existsSync(path)) return []
  try { return parseAliases(readFileSync(path, 'utf8')) } catch { return [] }
}

export async function urlsCommand(options: { project?: string }, command: Command): Promise<void> {
  const global = globals(command)
  const context = gatewayContext({ profile: global.profile })
  const scheme = context.config.tlsEnabled ? 'https' : 'http'
  const derived = routesFor(await inspectContainers(), context.config.domain, scheme)
    .map((route) => ({ ...route, alias: false }))
  const aliases = readAliases(context.root).map((alias) => ({
    project: alias.project,
    service: alias.service,
    container: alias.container,
    hostname: alias.host,
    url: `${scheme}://${alias.host}`,
    port: String(alias.port),
    state: 'alias',
    alias: true,
  }))
  const routes = [...derived, ...aliases]
    .filter((route) => !options.project || route.project === options.project)
    .sort((left, right) => left.hostname.localeCompare(right.hostname))
  const output = new Output(global)
  if (output.json) output.data({ instance: { name: context.config.projectName }, routes, urls: routes })
  else for (const route of routes) output.line(`${route.url}\t${route.project ?? '-'}\t${route.service ?? route.container}${route.alias ? '\talias' : ''}`)
}
