import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isTrue, readEnvFile, renderPanelAuth as renderSharedPanelAuth, setEnvValue, writeEnvFile } from '@dev-gateway/core'
import type { Command } from 'commander'
import { composeArguments, gatewayContext } from '../context.js'
import { ensureNetwork, inspectContainers } from '../docker.js'
import { PreconditionError, RefusedError, UsageError } from '../errors.js'
import { Output } from '../output.js'
import { runProcess } from '../process.js'

function globals(command: Command) { return command.optsWithGlobals() as { json?: boolean; yes?: boolean; quiet?: boolean; verbose?: boolean; profile?: string } }

function setValues(root: string, values: Record<string, string>): void {
  const path = join(root, '.env')
  let text = readEnvFile(path)
  for (const [key, value] of Object.entries(values)) text = setEnvValue(text, key, value)
  writeEnvFile(path, text)
}

async function webCompose(command: Command, args: string[], extraEnv: NodeJS.ProcessEnv = {}, stdio: 'inherit' | 'pipe' = 'inherit') {
  const context = gatewayContext({ profile: globals(command).profile })
  return runProcess('docker', ['compose', ...composeArguments(context), ...args], { cwd: context.root, env: { ...context.env, ...extraEnv }, stdio })
}

export async function webUp(options: { expose?: string; port?: string; readOnly?: boolean; writable?: boolean; dev?: boolean }, command: Command): Promise<void> {
  const initial = gatewayContext({ profile: globals(command).profile })
  const expose = options.expose ?? initial.config.webExpose
  if (!['local', 'vpn'].includes(expose)) throw new UsageError('--expose must be local or vpn')
  if (expose === 'vpn' && initial.config.profile === 'remote-public') throw new RefusedError('the panel must not be routed on the remote-public profile')
  const authConfigured = initial.env['DEV_GATEWAY_WEB_AUTH'] === 'basic' && Boolean(initial.env['DEV_GATEWAY_WEB_AUTH_USER']) && Boolean(initial.env['DEV_GATEWAY_WEB_AUTH_HASH'])
  if (expose === 'vpn' && !authConfigured) throw new RefusedError('a routed panel needs a credential', 'run dev-gateway web auth set first')
  const readOnly = options.writable ? false : options.readOnly ?? (expose === 'vpn' ? true : initial.config.webReadOnly)
  const values: Record<string, string> = {
    DEV_GATEWAY_WEB: 'true', DEV_GATEWAY_WEB_EXPOSE: expose, DEV_GATEWAY_WEB_READ_ONLY: String(readOnly), DEV_GATEWAY_WEB_DEV: String(options.dev === true),
  }
  if (options.port) values['DEV_GATEWAY_WEB_PORT'] = String(Number(options.port))
  if (!initial.env['DG_WEB_DB_PASSWORD']) values['DG_WEB_DB_PASSWORD'] = randomBytes(32).toString('hex')
  setValues(initial.root, values)
  mkdirSync(join(initial.root, 'state/git'), { recursive: true })
  mkdirSync(join(initial.root, 'state/github'), { recursive: true })
  mkdirSync(join(initial.root, 'config/traefik/dynamic'), { recursive: true })
  const context = gatewayContext({ profile: globals(command).profile })
  await ensureNetwork(context.config.network)
  await runProcess('docker', ['pull', 'alpine/socat:1.8.1.3'], { reject: false })
  await runProcess('docker', ['compose', ...composeArguments(context), 'up', '-d', 'db'], { cwd: context.root, env: context.env, reject: false })
  const services = options.dev ? ['web', 'web-ui', 'web-socket-proxy'] : ['web', 'web-socket-proxy']
  // `--remove-orphans`, as `dev-gateway up` already does: leaving development
  // mode drops compose.web-dev.yaml from the file list, and without this the
  // Vite container keeps serving a stale panel on its own port.
  await runProcess('docker', ['compose', ...composeArguments(context), 'up', '-d', '--build', '--remove-orphans', '--wait', '--wait-timeout', '180', ...services], { cwd: context.root, env: context.env, stdio: 'inherit' })
  // The context was resolved before .env was rewritten, so `web dev` would
  // otherwise report the URL the previous mode used.
  new Output(globals(command)).data(webUrl(gatewayContext({ profile: globals(command).profile })))
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
  if (context.config.webExpose === 'vpn') return `${context.config.tlsEnabled ? 'https' : 'http'}://${context.env['DEV_GATEWAY_WEB_HOST'] ?? 'dev-gateway-web'}.${context.config.domain}`
  const host = context.env['DEV_GATEWAY_WEB_BIND_ADDRESS'] ?? '127.0.0.1'
  const port = context.config.webDev
    ? (context.env['DEV_GATEWAY_WEB_DEV_PORT'] ?? '5173')
    : context.config.webPort
  return `http://${host}:${port}`
}

export async function webDown(command: Command): Promise<void> {
  const context = gatewayContext({ profile: globals(command).profile })
  const env = { ...context.env, DEV_GATEWAY_WEB: 'true', DEV_GATEWAY_WEB_DEV: 'true' }
  const services = ['db', 'web', 'web-socket-proxy']
  await runProcess('docker', ['compose', ...composeArguments({ ...context, env }), 'stop', ...services], { cwd: context.root, env, reject: false })
  await runProcess('docker', ['compose', ...composeArguments({ ...context, env }), 'rm', '-f', ...services], { cwd: context.root, env, reject: false })
  await runProcess('docker', ['compose', ...composeArguments({ ...context, env }), 'stop', 'web-ui'], { cwd: context.root, env, reject: false })
  await runProcess('docker', ['compose', ...composeArguments({ ...context, env }), 'rm', '-f', 'web-ui'], { cwd: context.root, env, reject: false })
  new Output(globals(command)).progress('panel stopped; gateway and projects were not touched')
}

export async function webDisable(command: Command): Promise<void> {
  await webDown(command)
  const context = gatewayContext({ profile: globals(command).profile })
  setValues(context.root, { DEV_GATEWAY_WEB: 'false' })
}

export async function webRestart(command: Command): Promise<void> { await webCompose(command, ['restart', 'web', 'web-socket-proxy']) }
export async function webLogs(service: string | undefined, command: Command): Promise<void> {
  const target = service ?? 'web'
  if (!['web', 'web-ui', 'web-socket-proxy', 'db'].includes(target)) throw new UsageError(`unknown panel service: ${target}`)
  const global = globals(command)
  if (global.json) {
    const result = await webCompose(command, ['logs', '--no-color', '--no-log-prefix', '--tail', '100', target], {}, 'pipe')
    new Output(global).data({ lines: result.stdout.split('\n').filter(Boolean) })
  } else await webCompose(command, ['logs', '--follow', '--tail', '100', target])
}
export async function webBuild(command: Command): Promise<void> { await webCompose(command, ['build', 'web']) }

export async function webStatus(command: Command): Promise<void> {
  const global = globals(command)
  const context = gatewayContext({ profile: global.profile })
  const containers = await inspectContainers()
  const panel = containers.find((container) => container.labels['dev-gateway.component'] === 'web')
  const proxy = containers.find((container) => container.labels['dev-gateway.component'] === 'web-socket-proxy')
  const value = { enabled: context.config.webEnabled, devMode: isTrue(context.env['DEV_GATEWAY_WEB_DEV']), readOnly: context.config.webReadOnly, expose: context.config.webExpose, url: webUrl(context), panel: { state: panel?.state ?? 'absent' }, socketProxy: { state: proxy?.state ?? 'absent' } }
  const output = new Output(global)
  if (output.json) output.data(value)
  else for (const [key, item] of Object.entries(value)) output.line(`${key}: ${typeof item === 'object' ? JSON.stringify(item) : String(item)}`)
}

export async function webOpen(command: Command): Promise<void> {
  const context = gatewayContext({ profile: globals(command).profile })
  const url = webUrl(context)
  new Output(globals(command)).data(url)
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open'
  await runProcess(opener, [url], { reject: false })
}

function authPath(root: string): string { return join(root, 'config/traefik/dynamic/dev-gateway-panel.yaml') }
export function renderPanelAuth(user?: string, hash?: string): string {
  return renderSharedPanelAuth(user && hash ? { user, hash } : null)
}
function renderAuth(root: string): void {
  const context = gatewayContext({ root })
  const configured = context.env['DEV_GATEWAY_WEB_AUTH'] === 'basic' && Boolean(context.env['DEV_GATEWAY_WEB_AUTH_USER']) && Boolean(context.env['DEV_GATEWAY_WEB_AUTH_HASH'])
  mkdirSync(join(root, 'config/traefik/dynamic'), { recursive: true })
  writeEnvFile(authPath(root), renderPanelAuth(configured ? context.env['DEV_GATEWAY_WEB_AUTH_USER'] : undefined, configured ? context.env['DEV_GATEWAY_WEB_AUTH_HASH'] : undefined))
}

export async function webAuthStatus(command: Command): Promise<void> {
  const context = gatewayContext({ profile: globals(command).profile })
  const value = { expose: context.config.webExpose, mode: context.env['DEV_GATEWAY_WEB_AUTH'] ?? 'none', user: context.env['DEV_GATEWAY_WEB_AUTH_USER'] || null, hashSet: Boolean(context.env['DEV_GATEWAY_WEB_AUTH_HASH']), middleware: authPath(context.root) }
  const output = new Output(globals(command)); if (output.json) output.data(value); else for (const [key, item] of Object.entries(value)) output.line(`${key}: ${String(item)}`)
}

export async function webAuthSet(options: { user?: string; passwordStdin?: boolean }, command: Command): Promise<void> {
  const context = gatewayContext({ profile: globals(command).profile })
  const user = options.user ?? context.env['DEV_GATEWAY_WEB_AUTH_USER'] ?? 'dev'
  if (!/^[A-Za-z0-9._-]+$/.test(user)) throw new UsageError(`invalid username: ${user}`)
  const generated = !options.passwordStdin
  const password = generated ? randomBytes(20).toString('base64url').slice(0, 20).match(/.{1,5}/g)!.join('-') : readFileSync(0, 'utf8').trim()
  if (!password) throw new UsageError('no password on stdin')
  const hashed = await runProcess('openssl', ['passwd', '-apr1', '-stdin'], { input: `${password}\n` })
  if (!hashed.stdout.startsWith('$apr1$')) throw new PreconditionError('openssl returned an unexpected password hash')
  setValues(context.root, { DEV_GATEWAY_WEB_AUTH: 'basic', DEV_GATEWAY_WEB_AUTH_USER: user, DEV_GATEWAY_WEB_AUTH_HASH: hashed.stdout.trim() })
  renderAuth(context.root)
  const output = new Output(globals(command))
  if (output.json) output.data({ user, password: generated ? password : undefined, generated })
  else { output.line(`user: ${user}`); if (generated) { output.line(`password: ${password}`); output.warning('this is the only time the generated password is shown') } }
}

export async function webAuthClear(command: Command): Promise<void> {
  const context = gatewayContext({ profile: globals(command).profile })
  if (context.config.webExpose === 'vpn') throw new RefusedError('refusing to leave a routed panel without a credential', 'run dev-gateway web up --expose local first')
  setValues(context.root, { DEV_GATEWAY_WEB_AUTH: 'none', DEV_GATEWAY_WEB_AUTH_USER: '', DEV_GATEWAY_WEB_AUTH_HASH: '' })
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
  const result = await runProcess(join(context.root, 'bin/dev-gateway'), [commandName, ...forwarded], { cwd: context.root, env: { ...context.env, DG_FORCE_BASH: 'true', DG_ASSUME_YES: globals(command).yes ? 'true' : context.env['DG_ASSUME_YES'] }, stdio: 'inherit', reject: false })
  if (result.exitCode !== 0) throw new PreconditionError(`${commandName} failed`, `see dev-gateway ${commandName} --help`)
}
