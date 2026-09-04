// The settings the panel is willing to touch.
//
// This catalogue is the whole surface: a key that is not listed here cannot be
// read through the API and cannot be written by it, whatever a request asks
// for. Secrets are listed so the UI can say whether they are set, and their
// values never leave the host.

import type { ConfigField } from 'portta-contracts'
import { normalizeProjectsHome, ProjectsHomeError } from 'portta-core'

export interface FieldSpec {
  key: string
  group: string
  label: string
  help: string
  kind: ConfigField['kind']
  choices?: string[]
  secret?: boolean
  /** Takes effect only once the gateway containers are recreated. */
  restartRequired: boolean
  validate?: (value: string) => string | null
}

const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/

function domain(value: string): string | null {
  if (value === '') return null
  return HOSTNAME.test(value) ? null : 'must be a hostname, for example dev.example.com'
}

function port(value: string): string | null {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1 || number > 65535) return 'must be a port between 1 and 65535'
  return null
}

function publicIp(value: string): string | null {
  if (value === '') return null
  return IPV4.test(value) ? null : 'must be an IPv4 address, for example 203.0.113.10'
}

function bindAddress(value: string): string | null {
  if (value === '') return null
  if (value === 'localhost' || value === '::1') return null
  return IPV4.test(value) ? null : 'must be an IPv4 address'
}

/**
 * An origin, not a URL with a path.
 *
 * The panel URL becomes Better Auth's `baseURL` and the origin a write must
 * come from, so a trailing path or a credential in it would silently widen or
 * break both.
 */
function panelUrl(value: string): string | null {
  if (value === '') return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'must be a URL, such as https://panel.example.com'
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'must be http or https'
  if (url.username || url.password) return 'must not carry a credential'
  if (url.pathname !== '/' || url.search || url.hash) return 'must be an origin, with no path'
  return null
}

function trustedOriginList(value: string): string | null {
  if (value === '') return null
  for (const entry of value.split(',')) {
    const refusal = panelUrl(entry.trim())
    if (refusal) return `${entry.trim()}: ${refusal}`
  }
  return null
}

function email(value: string): string | null {
  if (value === '') return null
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) ? null : 'must be an email address'
}

/**
 * The directory `docker/compose/features/web.yaml` mounts the key from. It is
 * the whole constraint on this setting: a path outside it names a file that is
 * not in the container at all, so the panel could never read it.
 */
const GITHUB_KEY_DIR = '/app/state/github/'

/**
 * The filename is the operator's, the directory is not. Refusing anything
 * outside the mount is what stops the Settings page and `portta doctor`
 * disagreeing about which file authenticates the App.
 */
function githubKeyFile(value: string): string | null {
  if (value === '') return null
  const outside = 'must be under /app/state/github/, the directory mounted into the panel'
  if (!value.startsWith(GITHUB_KEY_DIR) || value === GITHUB_KEY_DIR) return outside
  return value.split('/').includes('..') ? outside : null
}

function url(value: string): string | null {
  if (value === '') return null
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' ? null : 'must be an https URL'
  } catch {
    return 'must be a URL'
  }
}

/**
 * Lexical only. The panel never opens Projects Home; the host collector does.
 * An empty value keeps the installer / CLI default.
 */
function projectsHome(value: string): string | null {
  if (value === '') return null
  try {
    normalizeProjectsHome(value)
    return null
  } catch (error) {
    return error instanceof ProjectsHomeError ? error.message : 'must be an absolute directory'
  }
}

export const FIELDS: FieldSpec[] = [
  {
    key: 'PORTTA_PROJECTS_HOME',
    group: 'Projects',
    label: 'Projects Home',
    help:
      'The one directory this installation manages Projects in. Changing it changes the reference; ' +
      'files are not moved. Existing environments outside this path stay visible as unmanaged. ' +
      'See docs/adr/0031-projects-home-and-project.md.',
    kind: 'string',
    restartRequired: false,
    validate: projectsHome,
  },
  {
    key: 'PORTTA_PROFILE',
    group: 'Gateway',
    label: 'Profile',
    help: 'Which set of Compose overlays the gateway starts with.',
    kind: 'choice',
    choices: ['local', 'remote-private', 'remote-public'],
    restartRequired: true,
  },
  {
    key: 'PORTTA_DOMAIN_MODE',
    group: 'Project domain',
    label: 'Mode',
    help:
      'What every project hostname is built on. local is localhost, which only resolves on this machine. ' +
      'auto derives a name from this host public address and needs no DNS record. custom uses a wildcard you own.',
    kind: 'choice',
    choices: ['local', 'auto', 'custom'],
    restartRequired: true,
  },
  {
    key: 'PORTTA_PUBLIC_IP',
    group: 'Project domain',
    label: 'Public address',
    help: 'The address the auto mode builds a hostname from. Detected during installation.',
    kind: 'string',
    restartRequired: true,
    validate: publicIp,
  },
  {
    key: 'PORTTA_AUTO_DOMAIN_PROVIDER',
    group: 'Project domain',
    label: 'Wildcard DNS service',
    help: 'Both resolve any name embedding an address, so neither needs a record or an account.',
    kind: 'choice',
    choices: ['sslip.io', 'nip.io'],
    restartRequired: true,
  },
  {
    key: 'PORTTA_DOMAIN',
    group: 'Project domain',
    label: 'Custom domain',
    help: 'Used when the mode is custom. A wildcard *.<domain> must resolve to this host.',
    kind: 'string',
    restartRequired: true,
    validate: domain,
  },
  {
    key: 'PORTTA_BIND_ADDRESS',
    group: 'Gateway',
    label: 'Bind address',
    help: 'Host interface Traefik publishes on. 127.0.0.1 keeps it off the local network.',
    kind: 'string',
    restartRequired: true,
    validate: bindAddress,
  },
  {
    key: 'PORTTA_HTTP_PORT',
    group: 'Gateway',
    label: 'HTTP port',
    help: 'Host port for plain HTTP.',
    kind: 'number',
    restartRequired: true,
    validate: port,
  },
  {
    key: 'PORTTA_HTTPS_PORT',
    group: 'Gateway',
    label: 'HTTPS port',
    help: 'Host port for HTTPS.',
    kind: 'number',
    restartRequired: true,
    validate: port,
  },
  {
    key: 'PORTTA_LOG_LEVEL',
    group: 'Gateway',
    label: 'Log level',
    help: 'Log level for the gateway components.',
    kind: 'choice',
    choices: ['DEBUG', 'INFO', 'WARN', 'ERROR'],
    restartRequired: true,
  },
  {
    key: 'PORTTA_ACCESS_LOG',
    group: 'Gateway',
    label: 'Traefik access log',
    help: 'Useful while debugging routing, noisy otherwise.',
    kind: 'boolean',
    restartRequired: true,
  },
  {
    key: 'PORTTA_DASHBOARD',
    group: 'Traefik',
    label: 'Traefik dashboard',
    help: 'Traefik’s own dashboard, published on loopback only.',
    kind: 'boolean',
    restartRequired: true,
  },
  {
    key: 'PORTTA_DASHBOARD_PORT',
    group: 'Traefik',
    label: 'Dashboard port',
    help: 'Host port for the Traefik dashboard.',
    kind: 'number',
    restartRequired: true,
    validate: port,
  },
  {
    key: 'PORTTA_DASHBOARD_EXPOSE',
    group: 'Traefik',
    label: 'Dashboard access',
    help: 'local keeps :8080 on loopback. domain routes the dashboard on the gateway domain, behind the panel login.',
    kind: 'choice',
    choices: ['local', 'domain'],
    restartRequired: true,
  },
  {
    key: 'PORTTA_DASHBOARD_ADVERTISED_HOST',
    group: 'Traefik',
    label: 'Dashboard hostname',
    help: 'Derived as <project>-traefik.<domain> unless you override it. Required when access is domain.',
    kind: 'string',
    restartRequired: true,
  },
  {
    key: 'TLS_ENABLED',
    group: 'TLS',
    label: 'HTTPS',
    help: 'Master switch. With it off, only the HTTP entrypoint serves routes.',
    kind: 'boolean',
    restartRequired: true,
  },
  {
    key: 'TLS_MODE',
    group: 'TLS',
    label: 'TLS mode',
    help: 'local uses a certificate from a local CA; acme uses Let’s Encrypt.',
    kind: 'choice',
    choices: ['local', 'acme'],
    restartRequired: true,
  },
  {
    key: 'ACME_EMAIL',
    group: 'TLS',
    label: 'ACME contact',
    help: 'Required when TLS_MODE=acme.',
    kind: 'string',
    restartRequired: true,
    validate: email,
  },
  {
    key: 'ACME_CHALLENGE',
    group: 'TLS',
    label: 'ACME challenge',
    help: 'dns issues one wildcard and needs a provider credential; http issues one certificate per hostname and needs :80 reachable from the internet.',
    kind: 'choice',
    choices: ['dns', 'http'],
    restartRequired: true,
  },
  {
    key: 'ACME_CA_SERVER',
    group: 'TLS',
    label: 'ACME directory',
    help: 'Point at the staging endpoint while testing to avoid rate limits.',
    kind: 'string',
    restartRequired: true,
    validate: url,
  },
  {
    key: 'ACME_DNS_PROVIDER',
    group: 'TLS',
    label: 'DNS-01 provider',
    help: 'Provider name as understood by Traefik/lego. Ignored when the challenge is http.',
    kind: 'string',
    restartRequired: true,
  },
  {
    key: 'TAILSCALE_ENABLED',
    group: 'VPN',
    label: 'Tailscale',
    help: 'Run Traefik inside the Tailscale container’s network namespace.',
    kind: 'boolean',
    restartRequired: true,
  },
  {
    key: 'TAILSCALE_HOSTNAME',
    group: 'VPN',
    label: 'Tailscale hostname',
    help: 'Name this node takes on the tailnet.',
    kind: 'string',
    restartRequired: true,
    validate: domain,
  },
  {
    key: 'TS_AUTHKEY',
    group: 'VPN',
    label: 'Tailscale auth key',
    help: 'Prefer an ephemeral, tagged, pre-authorised key. Never leaves the host.',
    kind: 'string',
    secret: true,
    restartRequired: true,
  },
  {
    key: 'PRIVATE_DOMAIN',
    group: 'VPN',
    label: 'VPN domain',
    help: 'Private wildcard namespace served only over the VPN.',
    kind: 'string',
    restartRequired: true,
    validate: domain,
  },
  {
    key: 'PUBLIC_ENABLED',
    group: 'Public access',
    label: 'Public access',
    help: 'Publishes 80/443 on every interface. Only opted-in HTTP services are routed.',
    kind: 'boolean',
    restartRequired: true,
  },
  {
    key: 'PUBLIC_DOMAIN',
    group: 'Public access',
    label: 'Public domain',
    help: 'Public wildcard namespace, for example dev.example.com.',
    kind: 'string',
    restartRequired: true,
    validate: domain,
  },
  {
    key: 'CLOUDFLARE_ENABLED',
    group: 'DNS',
    label: 'Cloudflare DNS',
    help: 'Use Cloudflare for the wildcard record and DNS-01 challenges.',
    kind: 'boolean',
    restartRequired: true,
  },
  {
    key: 'CLOUDFLARE_ZONE',
    group: 'DNS',
    label: 'Cloudflare zone',
    help: 'The zone the wildcard record lives in.',
    kind: 'string',
    restartRequired: true,
    validate: domain,
  },
  {
    key: 'CF_DNS_API_TOKEN',
    group: 'DNS',
    label: 'Cloudflare API token',
    help: 'A scoped token (Zone:DNS:Edit), never the global API key.',
    kind: 'string',
    secret: true,
    restartRequired: true,
  },
  {
    key: 'PORTTA_WEB_PORT',
    group: 'Panel',
    label: 'Panel port',
    help: 'Host port this panel is published on.',
    kind: 'number',
    restartRequired: true,
    validate: port,
  },
  {
    key: 'PORTTA_WEB_BIND_ADDRESS',
    group: 'Panel',
    label: 'Panel bind address',
    help: 'Keep 127.0.0.1: the panel is never meant to face the internet.',
    kind: 'string',
    restartRequired: true,
    validate: bindAddress,
  },
  {
    key: 'PORTTA_WEB_EXPOSE',
    group: 'Panel',
    label: 'Reachable from',
    help:
      'local is loopback only. tailscale binds the tailnet address. public, vpn and domain put the panel ' +
      'beyond this host and all three require panel authentication. domain routes it on one hostname of the ' +
      "gateway's own domain, over the same HTTPS an application gets. See docs/adr/0021-panel-access-modes.md.",
    kind: 'choice',
    choices: ['local', 'tailscale', 'public', 'vpn', 'domain'],
    restartRequired: true,
  },
  {
    key: 'PORTTA_WEB_READ_ONLY',
    group: 'Panel',
    label: 'Read-only',
    help: 'Refuse every mutating endpoint. The default whenever the panel is routed.',
    kind: 'boolean',
    restartRequired: true,
  },
  {
    key: 'PORTTA_AUTH_MODE',
    group: 'Panel',
    label: 'Panel authentication',
    help: 'required makes the panel ask who you are: people sign in, agents carry a token. disabled makes every request the local operator, which is only allowed on loopback.',
    kind: 'choice',
    choices: ['disabled', 'required'],
    restartRequired: true,
  },
  {
    key: 'PORTTA_AUTH_SECRET',
    group: 'Panel',
    label: 'Session signing secret',
    help: 'What sessions and tokens are signed with. Generated during bootstrap; rotating it signs everybody out.',
    kind: 'string',
    secret: true,
    restartRequired: true,
  },
  {
    key: 'PORTTA_PANEL_URL',
    group: 'Panel',
    label: 'Panel URL',
    help: 'The address a browser reaches the panel on. It decides where sign-in redirects to and whether the session cookie may be Secure.',
    kind: 'string',
    restartRequired: true,
    validate: panelUrl,
  },
  {
    key: 'PORTTA_PANEL_TRUSTED_ORIGINS',
    group: 'Panel',
    label: 'Extra trusted origins',
    help: 'Other origins a browser may sign in from, comma-separated: a VPN name, a public domain. Loopback and the panel URL are always trusted.',
    kind: 'string',
    restartRequired: true,
    validate: trustedOriginList,
  },
  {
    key: 'PORTTA_RUNTIME_DOCS',
    group: 'Panel',
    label: 'Documentation',
    help: "Serve the project's documentation at /docs, from this image. Static text with no host information in it, so a routed panel may serve it.",
    kind: 'boolean',
    restartRequired: true,
  },
  {
    key: 'PORTTA_RUNTIME_API_DOCS',
    group: 'Panel',
    label: 'API reference',
    help: 'Serve the API reference and its console at /docs/api. It issues real requests against this panel, so empty uses the safe default: on for loopback, off when routed.',
    kind: 'boolean',
    restartRequired: true,
  },
  {
    key: 'PORTTA_RUNTIME_DB_PASSWORD',
    group: 'Panel',
    label: 'Database password',
    help: 'Generated bootstrap credential for the panel-owned PostgreSQL database.',
    kind: 'string',
    secret: true,
    restartRequired: true,
  },
  {
    key: 'GITHUB_APP_ENABLED',
    group: 'GitHub',
    label: 'GitHub App',
    help: 'Off by default. With this off the panel makes no outbound request and behaves exactly as before.',
    kind: 'boolean',
    restartRequired: true,
  },
  {
    key: 'GITHUB_APP_ID',
    group: 'GitHub',
    label: 'App id',
    help: 'The numeric id GitHub shows on the App settings page. Not a secret.',
    kind: 'string',
    restartRequired: true,
    validate: (value) => (value === '' || /^\d+$/.test(value) ? null : 'must be the numeric App id'),
  },
  {
    key: 'GITHUB_APP_PRIVATE_KEY_FILE',
    group: 'GitHub',
    label: 'Private key file',
    help: 'The .pem inside the container. The directory is fixed by the mount; the filename is the one GitHub gave you. Read-only at mode 600, and never a .env value.',
    kind: 'string',
    restartRequired: true,
    validate: githubKeyFile,
  },
  {
    key: 'GITHUB_APP_WEBHOOK_SECRET',
    group: 'GitHub',
    label: 'Webhook secret',
    help: 'Verifies deliveries GitHub sends. Stored as a secret and never returned.',
    kind: 'string',
    secret: true,
    restartRequired: true,
  },
  {
    key: 'GITHUB_API_URL',
    group: 'GitHub',
    label: 'API base URL',
    help: 'https://api.github.com, or your GitHub Enterprise Server API root.',
    kind: 'string',
    restartRequired: true,
    validate: url,
  },
  {
    key: 'GITHUB_SYNC_INTERVAL_MINUTES',
    group: 'GitHub',
    label: 'Reconciliation interval',
    help: 'Minutes between passes that re-read what changed. A loopback panel cannot receive webhooks, so this is what keeps the projection fresh. 0 turns it off.',
    kind: 'string',
    restartRequired: true,
    validate: (value) => (value === '' || /^\d+$/.test(value) ? null : 'must be a whole number of minutes, or 0 to turn it off'),
  },
]

export const FIELDS_BY_KEY = new Map(FIELDS.map((field) => [field.key, field]))

export function isSecret(key: string): boolean {
  return FIELDS_BY_KEY.get(key)?.secret === true
}

export class ValidationError extends Error {
  key: string
  constructor(key: string, message: string) {
    super(`${key}: ${message}`)
    this.name = 'ValidationError'
    this.key = key
  }
}

export function validateValue(key: string, value: string): void {
  const field = FIELDS_BY_KEY.get(key)
  if (!field) throw new ValidationError(key, 'is not a setting the panel manages')
  if (field.kind === 'boolean' && !['true', 'false'].includes(value)) {
    throw new ValidationError(key, 'must be true or false')
  }
  if (field.kind === 'choice' && !(field.choices ?? []).includes(value)) {
    throw new ValidationError(key, `must be one of ${(field.choices ?? []).join(', ')}`)
  }
  const problem = field.validate?.(value)
  if (problem) throw new ValidationError(key, problem)
}

/**
 * Refuses combinations the CLI would refuse at startup, so a save cannot leave
 * the gateway unable to come back up.
 */
export function validateCombination(values: Map<string, string>): void {
  const get = (key: string) => values.get(key) ?? ''
  const truthy = (key: string) => ['1', 'true', 'yes', 'on', 'enabled'].includes(get(key).toLowerCase())

  const profile = get('PORTTA_PROFILE') || 'local'
  if (profile === 'remote-public' && get('PUBLIC_DOMAIN') === '') {
    throw new ValidationError('PUBLIC_DOMAIN', 'is required by the remote-public profile')
  }
  if (profile === 'remote-private' && !truthy('TAILSCALE_ENABLED') && get('PORTTA_BIND_ADDRESS') === '0.0.0.0') {
    throw new ValidationError('PORTTA_BIND_ADDRESS', 'the remote-private profile must not bind 0.0.0.0')
  }
  if (truthy('TLS_ENABLED') && get('TLS_MODE') === 'acme' && get('ACME_EMAIL') === '') {
    throw new ValidationError('ACME_EMAIL', 'is required when TLS_MODE is acme')
  }
  if (truthy('TAILSCALE_ENABLED') && get('TS_AUTHKEY') === '' && get('TAILSCALE_HOSTNAME') === '') {
    throw new ValidationError('TAILSCALE_HOSTNAME', 'is required when Tailscale is enabled')
  }
  // A mode that cannot be honoured resolves to localhost, which is the failure
  // this whole setting exists to avoid. Refuse it here, where the operator is
  // looking, rather than letting it fall back quietly.
  const domainMode = get('PORTTA_DOMAIN_MODE') || 'local'
  if (domainMode === 'auto' && get('PORTTA_PUBLIC_IP') === '') {
    throw new ValidationError('PORTTA_PUBLIC_IP', 'is required by the auto domain mode')
  }
  if (domainMode === 'custom' && (get('PORTTA_DOMAIN') === '' || get('PORTTA_DOMAIN') === 'localhost')) {
    throw new ValidationError('PORTTA_DOMAIN', 'the custom domain mode needs a domain of its own')
  }

  // A routed panel can stop containers and, since ADR 0010, says what is being
  // worked on. The tailnet is a good boundary and a poor last one.
  if (['vpn', 'public', 'domain'].includes(get('PORTTA_WEB_EXPOSE'))) {
    if (get('PORTTA_AUTH_MODE') !== 'required') {
      throw new ValidationError('PORTTA_AUTH_MODE', 'must be required while the panel is reachable beyond this host')
    }
    if (get('PORTTA_AUTH_SECRET') === '') {
      throw new ValidationError(
        'PORTTA_AUTH_SECRET',
        'a panel that signs people in needs a signing secret: run portta bootstrap',
      )
    }
  }

  if (get('PORTTA_DASHBOARD_EXPOSE') === 'domain' && truthy('PORTTA_DASHBOARD')) {
    const domain = get('PORTTA_DOMAIN')
    if (domain === '' || domain === 'localhost') {
      throw new ValidationError('PORTTA_DASHBOARD_EXPOSE', 'a dashboard on the domain needs a domain of its own')
    }
    // The dashboard used to borrow the panel's BasicAuth credential, and the
    // panel no longer has one: it signs people in itself. Traefik's dashboard
    // exposes the routing of every project on the host, so an unprotected one
    // on a domain is refused rather than warned about. Loopback still works.
    throw new ValidationError(
      'PORTTA_DASHBOARD_EXPOSE',
      'the dashboard has no credential of its own; reach it on loopback instead',
    )
  }

  if (get('PORTTA_WEB_BIND_ADDRESS') === '0.0.0.0') {
    throw new ValidationError(
      'PORTTA_WEB_BIND_ADDRESS',
      'the panel is not published on every interface; reach it over the VPN instead',
    )
  }
}
