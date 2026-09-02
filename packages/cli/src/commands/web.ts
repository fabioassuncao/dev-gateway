import { randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  hashPassword,
  PANEL_ACCESS_MODES,
  panelProtectionRecord,
  isPanelAccess,
  isTrue,
  readEnvFile,
  readProtectionStore,
  removeProtection,
  renderAuthDynamic,
  renderPanelAuth as renderSharedPanelAuth,
  setEnvValue,
  setProtection,
  writeEnvFile,
  writeProtectionStore,
} from 'portta-core'
import type { Command } from 'commander'
import { composeArguments, gatewayContext } from '../context.js'
import { ensureNetwork, inspectContainers } from '../docker.js'
import { PreconditionError, RefusedError, UsageError } from '../errors.js'
import { Output } from '../output.js'
import { runProcess } from '../process.js'
import { refreshGitMetadata } from './git.js'

function globals(command: Command) { return command.optsWithGlobals() as { json?: boolean; yes?: boolean; quiet?: boolean; verbose?: boolean; profile?: string } }

function setValues(root: string, values: Record<string, string>): void {
  const path = join(root, '.env')
  let text = readEnvFile(path)
  for (const [key, value] of Object.entries(values)) text = setEnvValue(text, key, value)
  writeEnvFile(path, text)
}

export function syncPanelProtection(root: string, overrides: Record<string, string> = {}): void {
  const context = gatewayContext({ root, overrides })
  const storePath = join(root, 'state/auth/protections.json')
  const current = readProtectionStore(storePath)
  const record = panelProtectionRecord({
    mode: context.env['PORTTA_WEB_AUTH'] ?? 'none', expose: context.env['PORTTA_WEB_EXPOSE'] ?? 'local',
    user: context.env['PORTTA_WEB_AUTH_USER'] ?? '', hash: context.env['PORTTA_WEB_AUTH_HASH'] ?? '',
    webHost: context.env['PORTTA_WEB_HOST'] ?? 'portta-web', domain: context.config.domain,
    advertisedHost: context.env['PORTTA_PANEL_ADVERTISED_HOST'] || context.env['PORTTA_PUBLIC_IP'] || null,
    port: context.env['PORTTA_WEB_PORT'] ?? '8081', tlsEnabled: context.config.tlsEnabled,
    projectName: context.config.projectName,
  })
  const existing = current.protections.find((protection) => protection.scope === 'panel')
  const same = record && existing
    ? JSON.stringify({ ...existing, epoch: undefined }) === JSON.stringify({ ...record, epoch: undefined })
    : record === null && existing === undefined
  const next = same ? current : record ? setProtection(current, record) : removeProtection(current, 'panel')
  writeProtectionStore(storePath, next)
  const dynamic = join(root, 'config/traefik/dynamic')
  mkdirSync(dynamic, { recursive: true })
  writeEnvFile(join(dynamic, 'portta-auth.yaml'), renderAuthDynamic(next))
  writeEnvFile(join(dynamic, 'portta-panel.yaml'), renderSharedPanelAuth(null))
}

/**
 * Every panel command addresses the panel, so it resolves the file list with
 * the panel enabled. Without that, an inherited PORTTA_WEB=false drops the
 * overlays that define these services and Compose answers "no such service",
 * which the callers below deliberately ignore — so the command reports success
 * and does nothing.
 */
const PANEL_OVERRIDES = { PORTTA_WEB: 'true' }

async function webCompose(command: Command, args: string[], extraEnv: NodeJS.ProcessEnv = {}, stdio: 'inherit' | 'pipe' = 'inherit') {
  const context = gatewayContext({ profile: globals(command).profile, overrides: PANEL_OVERRIDES })
  return runProcess('docker', ['compose', ...composeArguments(context), ...args], { cwd: context.root, env: { ...context.env, ...extraEnv }, stdio })
}

export async function webUp(options: { expose?: string; port?: string; readOnly?: boolean; writable?: boolean; dev?: boolean }, command: Command): Promise<void> {
  const initial = gatewayContext({ profile: globals(command).profile })
  const expose = options.expose ?? initial.config.webExpose
  if (!isPanelAccess(expose)) throw new UsageError(`--expose must be one of: ${PANEL_ACCESS_MODES.join(', ')}`)
  if (expose === 'vpn' && initial.config.profile === 'remote-public') throw new RefusedError('the panel must not be routed on the remote-public profile')
  const authConfigured = initial.env['PORTTA_WEB_AUTH'] === 'basic' && Boolean(initial.env['PORTTA_WEB_AUTH_USER']) && Boolean(initial.env['PORTTA_WEB_AUTH_HASH'])
  // Anything the panel can be reached on from another machine sits behind the
  // Traefik middleware first. `local` and `tailscale` publish a host port and
  // are governed by the interface they bind, not by a credential.
  if ((expose === 'vpn' || expose === 'public') && !authConfigured) throw new RefusedError(`panel access '${expose}' needs a credential`, 'run portta web auth set first')
  const readOnly = options.writable ? false : options.readOnly ?? (expose === 'vpn' ? true : initial.config.webReadOnly)
  const values: Record<string, string> = {
    PORTTA_WEB: 'true', PORTTA_WEB_EXPOSE: expose, PORTTA_WEB_READ_ONLY: String(readOnly), PORTTA_WEB_DEV: String(options.dev === true),
  }
  if (options.port) values['PORTTA_WEB_PORT'] = String(Number(options.port))
  if (!initial.env['PORTTA_RUNTIME_DB_PASSWORD']) values['PORTTA_RUNTIME_DB_PASSWORD'] = randomBytes(32).toString('hex')
  if (!initial.env['PORTTA_AUTH_SECRET']) values['PORTTA_AUTH_SECRET'] = randomBytes(32).toString('hex')
  // The Settings page writes .env, and .env is owner-only, so the container has
  // to run as whoever owns it. The installer records this; starting the panel
  // from a checkout had nothing that did, so it fell back to the image's `node`
  // (uid 1000) and could not write a file owned by anyone else. Only set when
  // the platform reports a uid: on Windows process.getuid is undefined.
  if (!initial.env['PORTTA_WEB_USER'] && typeof process.getuid === 'function') {
    values['PORTTA_WEB_USER'] = `${process.getuid()}:${process.getgid?.() ?? 0}`
  }
  setValues(initial.root, values)
  mkdirSync(join(initial.root, 'state/git'), { recursive: true })
  mkdirSync(join(initial.root, 'state/github'), { recursive: true })
  mkdirSync(join(initial.root, 'state/auth'), { recursive: true, mode: 0o700 })
  chmodSync(join(initial.root, 'state/auth'), 0o700)
  mkdirSync(join(initial.root, 'config/traefik/dynamic'), { recursive: true })
  syncPanelProtection(initial.root, values)
  // The values just written win over anything inherited: a PORTTA_WEB=false in
  // the environment would otherwise drop the panel overlays and leave Compose
  // starting a service that no longer exists in its file list.
  const context = gatewayContext({ profile: globals(command).profile, overrides: values })
  await ensureNetwork(context.config.network)
  await runProcess('docker', ['pull', 'alpine/socat:1.8.1.3'], { reject: false })
  await runProcess('docker', ['compose', ...composeArguments(context), 'up', '-d', 'db'], { cwd: context.root, env: context.env, reject: false })
  const services = options.dev ? ['portta-auth', 'web', 'web-ui', 'web-socket-proxy'] : ['portta-auth', 'web', 'web-socket-proxy']
  // `--remove-orphans`, as `portta up` already does: leaving development
  // mode drops docker/compose/features/web-dev.yaml from the file list, and without this the
  // Vite container keeps serving a stale panel on its own port.
  // `--build` only where a build overlay is actually applied: an installed
  // PORTTA_HOME has no source tree, and asking Compose to build there fails.
  const buildArgs = context.config.webDev || context.config.webBuild ? ['--build'] : []
  await runProcess('docker', ['compose', ...composeArguments(context), 'up', '-d', ...buildArgs, '--remove-orphans', '--wait', '--wait-timeout', '180', ...services], { cwd: context.root, env: context.env, stdio: 'inherit' })
  const output = new Output(globals(command))
  await refreshGitMetadata(context.config.profile, output)
  // The context was resolved before .env was rewritten, so `web dev` would
  // otherwise report the URL the previous mode used.
  output.data(webUrl(gatewayContext({ profile: globals(command).profile, overrides: values })))
}

/**
 * Where the panel actually answers.
 *
 * In development Vite owns the port and proxies `/api` to the server beside
 * it; the server's own port serves no UI at all, because the dev image never
 * builds one. Reporting 8081 there sends people to a page that only explains
 * itself.
 */
export function webUrl(context: ReturnType<typeof gatewayContext>): string {
  if (context.config.webExpose === 'vpn') return `${context.config.tlsEnabled ? 'https' : 'http'}://${context.env['PORTTA_WEB_HOST'] ?? 'portta-web'}.${context.config.domain}`
  // In `public` mode the port belongs to Traefik and 0.0.0.0 is not an address
  // anybody types, so report the host's own reachable address instead.
  if (context.config.webExpose === 'public') {
    const advertised = context.env['PORTTA_PANEL_ADVERTISED_HOST'] || null
    return `http://${advertised ?? '<this-host>'}:${context.config.webPort}`
  }
  const host = context.env['PORTTA_WEB_BIND_ADDRESS'] ?? '127.0.0.1'
  const port = context.config.webDev
    ? (context.env['PORTTA_WEB_DEV_PORT'] ?? '5173')
    : context.config.webPort
  return `http://${host}:${port}`
}

export async function webDown(command: Command): Promise<void> {
  // Both overlays, so the file list names every service this stops: the dev
  // pair exists only while PORTTA_WEB_DEV is on, and leaving it out is how a
  // Vite container survives `web down` and keeps serving a stale panel.
  const context = gatewayContext({ profile: globals(command).profile, overrides: { ...PANEL_OVERRIDES, PORTTA_WEB_DEV: 'true' } })
  const env = { ...context.env, PORTTA_WEB: 'true', PORTTA_WEB_DEV: 'true' }
  const services = ['db', 'web', 'web-socket-proxy']
  await runProcess('docker', ['compose', ...composeArguments({ ...context, env }), 'stop', ...services], { cwd: context.root, env, reject: false })
  await runProcess('docker', ['compose', ...composeArguments({ ...context, env }), 'rm', '-f', ...services], { cwd: context.root, env, reject: false })
  await runProcess('docker', ['compose', ...composeArguments({ ...context, env }), 'stop', 'web-ui'], { cwd: context.root, env, reject: false })
  await runProcess('docker', ['compose', ...composeArguments({ ...context, env }), 'rm', '-f', 'web-ui'], { cwd: context.root, env, reject: false })
  new Output(globals(command)).progress('panel stopped; gateway and projects were not touched')
}

export async function webDisable(command: Command): Promise<void> {
  await webDown(command)
  const context = gatewayContext({ profile: globals(command).profile, overrides: PANEL_OVERRIDES })
  setValues(context.root, { PORTTA_WEB: 'false' })
}

export async function webRestart(command: Command): Promise<void> { await webCompose(command, ['restart', 'web', 'web-socket-proxy']) }
export async function webLogs(service: string | undefined, command: Command): Promise<void> {
  const target = service ?? 'web'
  if (!['web', 'web-ui', 'web-socket-proxy', 'db', 'portta-auth'].includes(target)) throw new UsageError(`unknown panel service: ${target}`)
  const global = globals(command)
  if (global.json) {
    const result = await webCompose(command, ['logs', '--no-color', '--no-log-prefix', '--tail', '100', target], {}, 'pipe')
    new Output(global).data({ lines: result.stdout.split('\n').filter(Boolean) })
  } else await webCompose(command, ['logs', '--follow', '--tail', '100', target])
}
export async function webBuild(command: Command): Promise<void> { await webCompose(command, ['build', 'web']) }

export async function webStatus(command: Command): Promise<void> {
  const global = globals(command)
  const context = gatewayContext({ profile: global.profile, overrides: PANEL_OVERRIDES })
  const containers = await inspectContainers()
  const panel = containers.find((container) => container.labels['portta.component'] === 'web')
  const proxy = containers.find((container) => container.labels['portta.component'] === 'web-socket-proxy')
  const value = { enabled: context.config.webEnabled, devMode: isTrue(context.env['PORTTA_WEB_DEV']), readOnly: context.config.webReadOnly, expose: context.config.webExpose, url: webUrl(context), panel: { state: panel?.state ?? 'absent' }, socketProxy: { state: proxy?.state ?? 'absent' } }
  const output = new Output(global)
  if (output.json) output.data(value)
  else for (const [key, item] of Object.entries(value)) output.line(`${key}: ${typeof item === 'object' ? JSON.stringify(item) : String(item)}`)
}

export async function webOpen(command: Command): Promise<void> {
  const context = gatewayContext({ profile: globals(command).profile })
  const url = webUrl(context)
  new Output(globals(command)).data(url)
  const opener = process.platform === 'darwin' ? 'open' : 'xportta-open'
  await runProcess(opener, [url], { reject: false })
}

function authPath(root: string): string { return join(root, 'config/traefik/dynamic/portta-auth.yaml') }
export function renderPanelAuth(user?: string, hash?: string): string {
  return renderSharedPanelAuth(user && hash ? { user, hash } : null)
}
function renderAuth(root: string): void {
  syncPanelProtection(root)
}

export async function webAuthStatus(command: Command): Promise<void> {
  const context = gatewayContext({ profile: globals(command).profile })
  const value = { expose: context.config.webExpose, mode: context.env['PORTTA_WEB_AUTH'] ?? 'none', user: context.env['PORTTA_WEB_AUTH_USER'] || null, hashSet: Boolean(context.env['PORTTA_WEB_AUTH_HASH']), middleware: authPath(context.root) }
  const output = new Output(globals(command)); if (output.json) output.data(value); else for (const [key, item] of Object.entries(value)) output.line(`${key}: ${String(item)}`)
}

export async function webAuthSet(options: { user?: string; passwordStdin?: boolean }, command: Command): Promise<void> {
  const context = gatewayContext({ profile: globals(command).profile })
  const user = options.user ?? context.env['PORTTA_WEB_AUTH_USER'] ?? 'dev'
  if (!/^[A-Za-z0-9._-]+$/.test(user)) throw new UsageError(`invalid username: ${user}`)
  const generated = !options.passwordStdin
  const password = generated ? randomBytes(20).toString('base64url').slice(0, 20).match(/.{1,5}/g)!.join('-') : readFileSync(0, 'utf8').trim()
  if (!password) throw new UsageError('no password on stdin')
  const hash = await hashPassword(password)
  setValues(context.root, { PORTTA_WEB_AUTH: 'basic', PORTTA_WEB_AUTH_USER: user, PORTTA_WEB_AUTH_HASH: hash })
  renderAuth(context.root)
  const output = new Output(globals(command))
  if (output.json) output.data({ user, password: generated ? password : undefined, generated })
  else { output.line(`user: ${user}`); if (generated) { output.line(`password: ${password}`); output.warning('this is the only time the generated password is shown') } }
}

export async function webAuthClear(command: Command): Promise<void> {
  const context = gatewayContext({ profile: globals(command).profile })
  if (context.config.webExpose === 'vpn' || context.config.webExpose === 'public') throw new RefusedError('refusing to leave a routed panel without a credential', 'run portta web up --expose local first')
  setValues(context.root, { PORTTA_WEB_AUTH: 'none', PORTTA_WEB_AUTH_USER: '', PORTTA_WEB_AUTH_HASH: '' })
  renderAuth(context.root)
  new Output(globals(command)).progress('panel credential removed')
}

export async function webAuthApply(command: Command): Promise<void> {
  const context = gatewayContext({ profile: globals(command).profile })
  renderAuth(context.root)
  new Output(globals(command)).progress(`rendered ${authPath(context.root)} from .env`)
}

export async function legacy(commandName: string, args: string[], command: Command): Promise<void> {
  const context = gatewayContext({ profile: globals(command).profile })
  const forwarded = [...args]
  if (commandName === 'remote' && globals(command).json && ['status', 'doctor', 'urls'].includes(forwarded[0] ?? '')) forwarded.push('--json')
  const result = await runProcess(join(context.root, 'bin/portta'), [commandName, ...forwarded], { cwd: context.root, env: { ...context.env, PORTTA_FORCE_BASH: 'true', PORTTA_ASSUME_YES: globals(command).yes ? 'true' : context.env['PORTTA_ASSUME_YES'] }, stdio: 'inherit', reject: false })
  if (result.exitCode !== 0) throw new PreconditionError(`${commandName} failed`, `see portta ${commandName} --help`)
}
