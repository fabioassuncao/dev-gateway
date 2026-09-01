import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PANEL_ACCESS_MODES, isPanelAccess, readEnvFile, renderPanelAuth, setEnvValue, writeEnvFile } from 'portta-core'
import type { Command } from 'commander'
import { composeArguments, gatewayContext } from '../context.js'
import { PreconditionError, RefusedError, UsageError } from '../errors.js'
import { Output } from '../output.js'
import { runProcess } from '../process.js'

function globals(command: Command) {
  return command.optsWithGlobals() as { json?: boolean; yes?: boolean; quiet?: boolean; verbose?: boolean; profile?: string }
}

/**
 * The settings worth naming. `.env` stays the file of record and holds more
 * than this; these are the ones somebody changes on a running installation,
 * given a stable name so a script does not have to know which variable
 * implements them.
 */
interface Setting {
  key: string
  description: string
  /** Values this setting accepts, when the set is closed. */
  allowed?: readonly string[]
}

const SETTINGS: Record<string, Setting> = {
  'panel.access': { key: 'PORTTA_WEB_EXPOSE', description: 'how the panel is reached', allowed: PANEL_ACCESS_MODES },
  'panel.port': { key: 'PORTTA_WEB_PORT', description: 'host port the panel answers on' },
  'panel.user': { key: 'PORTTA_WEB_AUTH_USER', description: 'panel username' },
  'panel.readOnly': { key: 'PORTTA_WEB_READ_ONLY', description: 'refuse every mutating panel endpoint', allowed: ['true', 'false'] },
  'panel.image': { key: 'PORTTA_WEB_IMAGE', description: 'published panel image' },
  'gateway.profile': { key: 'PORTTA_PROFILE', description: 'local, remote-private or remote-public', allowed: ['local', 'remote-private', 'remote-public'] },
  'gateway.domain': { key: 'PORTTA_DOMAIN', description: 'base domain for generated hostnames' },
  'gateway.bindAddress': { key: 'PORTTA_BIND_ADDRESS', description: 'interface Traefik publishes 80/443 on' },
  'public.domain': { key: 'PUBLIC_DOMAIN', description: 'public wildcard namespace' },
  'public.enabled': { key: 'PUBLIC_ENABLED', description: 'whether HTTP services may be published', allowed: ['true', 'false'] },
  'private.domain': { key: 'PRIVATE_DOMAIN', description: 'wildcard namespace served over the VPN' },
  'tls.enabled': { key: 'TLS_ENABLED', description: 'serve HTTPS', allowed: ['true', 'false'] },
  'tls.mode': { key: 'TLS_MODE', description: 'local certificate authority or ACME', allowed: ['local', 'acme'] },
  'dashboard.enabled': { key: 'PORTTA_DASHBOARD', description: "Traefik's own dashboard, on loopback", allowed: ['true', 'false'] },
  'tcp.enabled': { key: 'PORTTA_TCP', description: 'route datastores by hostname', allowed: ['true', 'false'] },
  'tailscale.enabled': { key: 'TAILSCALE_ENABLED', description: 'run the Tailscale sidecar', allowed: ['true', 'false'] },
}

/** Never printed, never returned, not even truncated. */
const SECRETS = new Set([
  'PORTTA_WEB_AUTH_HASH', 'PORTTA_RUNTIME_DB_PASSWORD', 'PORTTA_RUNTIME_DATABASE_URL',
  'TS_AUTHKEY', 'CF_DNS_API_TOKEN', 'GITHUB_APP_WEBHOOK_SECRET',
])

function setting(name: string): Setting {
  const found = SETTINGS[name]
  if (!found) throw new UsageError(`unknown setting: ${name}`, `portta config list shows the ${Object.keys(SETTINGS).length} settings this understands`)
  return found
}

function write(root: string, values: Record<string, string>): void {
  const path = join(root, '.env')
  let text = readEnvFile(path)
  for (const [key, value] of Object.entries(values)) text = setEnvValue(text, key, value)
  writeEnvFile(path, text)
}

export async function configList(command: Command): Promise<void> {
  const global = globals(command)
  const context = gatewayContext({ profile: global.profile })
  const rows = Object.entries(SETTINGS).map(([name, item]) => ({
    setting: name,
    variable: item.key,
    value: SECRETS.has(item.key) ? (context.env[item.key] ? '<set>' : '') : (context.env[item.key] ?? ''),
    description: item.description,
  }))
  const output = new Output(global)
  if (output.json) { output.data({ root: context.root, settings: rows }); return }
  for (const row of rows) output.line(`${row.setting.padEnd(22)} ${String(row.value).padEnd(24)} ${row.description}`)
}

export async function configGet(name: string, command: Command): Promise<void> {
  const global = globals(command)
  const context = gatewayContext({ profile: global.profile })
  const item = setting(name)
  if (SECRETS.has(item.key)) throw new RefusedError(`${name} is a secret and is never printed`, 'portta web auth status reports whether it is set')
  const value = context.env[item.key] ?? ''
  const output = new Output(global)
  if (output.json) output.data({ setting: name, variable: item.key, value })
  else output.line(value)
}

/**
 * Applying a setting means recreating the gateway, because most of them are
 * baked into Traefik's static configuration or into which overlays Compose is
 * given. Doing it here is the difference between a setting that took effect
 * and one that will take effect the next time somebody remembers.
 */
async function apply(root: string, profile: string | undefined, values: Record<string, string>, output: Output): Promise<void> {
  // The values just written win over anything inherited, for the same reason
  // `web up` needs it: the environment normally beats the file.
  const context = gatewayContext({ root, profile, overrides: values })
  output.progress('recreating gateway components')
  await runProcess('docker', ['compose', ...composeArguments(context), 'up', '-d', '--remove-orphans', '--wait', '--wait-timeout', '180'], { cwd: context.root, env: context.env, stdio: 'inherit' })
}

async function tailscaleAddress(): Promise<string | null> {
  const result = await runProcess('tailscale', ['ip', '-4'], { reject: false })
  const address = result.stdout.split('\n')[0]?.trim() ?? ''
  return result.exitCode === 0 && address ? address : null
}

/**
 * Panel access is the one setting with consequences beyond its own variable:
 * it decides which interface the panel is published on, whether a credential
 * is mandatory, and which overlay owns the port. Setting it by hand in .env
 * gets one of those three wrong, so it is resolved here instead.
 */
async function setPanelAccess(root: string, value: string, output: Output): Promise<Record<string, string>> {
  if (!isPanelAccess(value)) throw new UsageError(`panel.access must be one of: ${PANEL_ACCESS_MODES.join(', ')}`)
  const context = gatewayContext({ root })
  const values: Record<string, string> = { PORTTA_WEB_EXPOSE: value, PORTTA_WEB: 'true' }
  const credentialled = context.env['PORTTA_WEB_AUTH'] === 'basic'
    && Boolean(context.env['PORTTA_WEB_AUTH_USER']) && Boolean(context.env['PORTTA_WEB_AUTH_HASH'])

  if ((value === 'public' || value === 'vpn') && !credentialled) {
    throw new RefusedError(
      `panel access '${value}' would put the panel beyond this host with no credential in front of it`,
      'run portta web auth set first; it generates a password and shows it once',
    )
  }
  if (value === 'vpn' && context.config.profile === 'remote-public') {
    throw new RefusedError('the panel must not be routed on the remote-public profile')
  }

  switch (value) {
    case 'public':
      if (context.config.profile !== 'local' && context.config.tailscaleEnabled) {
        throw new RefusedError('panel access `public` cannot be combined with the Tailscale attachment', 'use panel.access tailscale, or set tailscale.enabled false')
      }
      values['PORTTA_WEB_BIND_ADDRESS'] = '0.0.0.0'
      output.warning('the panel will be reachable from every network this host is on; authentication is enforced by the proxy')
      break
    case 'tailscale': {
      const address = await tailscaleAddress()
      if (!address) throw new PreconditionError('this host has no Tailscale address', 'connect it yourself with `tailscale up`, then set this again')
      values['PORTTA_WEB_BIND_ADDRESS'] = address
      values['PORTTA_PANEL_ADVERTISED_HOST'] = address
      break
    }
    case 'local':
      values['PORTTA_WEB_BIND_ADDRESS'] = '127.0.0.1'
      values['PORTTA_PANEL_ADVERTISED_HOST'] = '127.0.0.1'
      break
    case 'vpn':
      values['PORTTA_WEB_BIND_ADDRESS'] = '127.0.0.1'
      break
  }

  // The middleware file is what Traefik actually reads, and a mode change is
  // exactly when it tends to be missing. Render it from .env either way.
  const dynamic = join(root, 'config/traefik/dynamic')
  mkdirSync(dynamic, { recursive: true })
  writeFileSync(
    join(dynamic, 'portta-panel.yaml'),
    renderPanelAuth(credentialled ? { user: context.env['PORTTA_WEB_AUTH_USER']!, hash: context.env['PORTTA_WEB_AUTH_HASH']! } : null),
    { mode: 0o600 },
  )
  return values
}

export async function configSet(name: string, value: string, options: { apply?: boolean }, command: Command): Promise<void> {
  const global = globals(command)
  const output = new Output(global)
  const context = gatewayContext({ profile: global.profile })
  const item = setting(name)
  if (SECRETS.has(item.key)) throw new RefusedError(`${name} is a secret and is not set this way`, 'portta web auth set writes the panel credential')
  if (item.allowed && !item.allowed.includes(value)) throw new UsageError(`${name} must be one of: ${item.allowed.join(', ')}`)

  const values = name === 'panel.access'
    ? await setPanelAccess(context.root, value, output)
    : { [item.key]: value }

  write(context.root, values)
  output.progress(`${name} = ${value}`)

  if (options.apply === false) {
    output.hint('nothing was restarted: run portta up to apply it')
  } else {
    await apply(context.root, global.profile, values, output)
  }

  if (output.json) output.data({ setting: name, value, applied: options.apply !== false, changed: values })
}
