// The settings the panel is willing to touch.
//
// This catalogue is the whole surface: a key that is not listed here cannot be
// read through the API and cannot be written by it, whatever a request asks
// for. Secrets are listed so the UI can say whether they are set, and their
// values never leave the host.

import type { ConfigField } from '../../shared/types.ts'

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

function bindAddress(value: string): string | null {
  if (value === '') return null
  if (value === 'localhost' || value === '::1') return null
  return IPV4.test(value) ? null : 'must be an IPv4 address'
}

function email(value: string): string | null {
  if (value === '') return null
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) ? null : 'must be an email address'
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

export const FIELDS: FieldSpec[] = [
  {
    key: 'DEV_GATEWAY_PROFILE',
    group: 'Gateway',
    label: 'Profile',
    help: 'Which set of Compose overlays the gateway starts with.',
    kind: 'choice',
    choices: ['local', 'remote-private', 'remote-public'],
    restartRequired: true,
  },
  {
    key: 'DEV_GATEWAY_DOMAIN',
    group: 'Gateway',
    label: 'Local domain',
    help: 'Base domain for generated hostnames: <project>-<service>.<domain>.',
    kind: 'string',
    restartRequired: true,
    validate: domain,
  },
  {
    key: 'DEV_GATEWAY_BIND_ADDRESS',
    group: 'Gateway',
    label: 'Bind address',
    help: 'Host interface Traefik publishes on. 127.0.0.1 keeps it off the local network.',
    kind: 'string',
    restartRequired: true,
    validate: bindAddress,
  },
  {
    key: 'DEV_GATEWAY_HTTP_PORT',
    group: 'Gateway',
    label: 'HTTP port',
    help: 'Host port for plain HTTP.',
    kind: 'number',
    restartRequired: true,
    validate: port,
  },
  {
    key: 'DEV_GATEWAY_HTTPS_PORT',
    group: 'Gateway',
    label: 'HTTPS port',
    help: 'Host port for HTTPS.',
    kind: 'number',
    restartRequired: true,
    validate: port,
  },
  {
    key: 'DEV_GATEWAY_LOG_LEVEL',
    group: 'Gateway',
    label: 'Log level',
    help: 'Log level for the gateway components.',
    kind: 'choice',
    choices: ['DEBUG', 'INFO', 'WARN', 'ERROR'],
    restartRequired: true,
  },
  {
    key: 'DEV_GATEWAY_ACCESS_LOG',
    group: 'Gateway',
    label: 'Traefik access log',
    help: 'Useful while debugging routing, noisy otherwise.',
    kind: 'boolean',
    restartRequired: true,
  },
  {
    key: 'DEV_GATEWAY_DASHBOARD',
    group: 'Traefik',
    label: 'Traefik dashboard',
    help: 'Traefik’s own dashboard, published on loopback only.',
    kind: 'boolean',
    restartRequired: true,
  },
  {
    key: 'DEV_GATEWAY_DASHBOARD_PORT',
    group: 'Traefik',
    label: 'Dashboard port',
    help: 'Host port for the Traefik dashboard.',
    kind: 'number',
    restartRequired: true,
    validate: port,
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
    help: 'local uses a certificate from a local CA; acme uses Let’s Encrypt over DNS-01.',
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
    help: 'Provider name as understood by Traefik/lego.',
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
    key: 'DEV_GATEWAY_WEB_PORT',
    group: 'Panel',
    label: 'Panel port',
    help: 'Host port this panel is published on.',
    kind: 'number',
    restartRequired: true,
    validate: port,
  },
  {
    key: 'DEV_GATEWAY_WEB_BIND_ADDRESS',
    group: 'Panel',
    label: 'Panel bind address',
    help: 'Keep 127.0.0.1: the panel is never meant to face the internet.',
    kind: 'string',
    restartRequired: true,
    validate: bindAddress,
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

  const profile = get('DEV_GATEWAY_PROFILE') || 'local'
  if (profile === 'remote-public' && get('PUBLIC_DOMAIN') === '') {
    throw new ValidationError('PUBLIC_DOMAIN', 'is required by the remote-public profile')
  }
  if (profile === 'remote-private' && !truthy('TAILSCALE_ENABLED') && get('DEV_GATEWAY_BIND_ADDRESS') === '0.0.0.0') {
    throw new ValidationError('DEV_GATEWAY_BIND_ADDRESS', 'the remote-private profile must not bind 0.0.0.0')
  }
  if (truthy('TLS_ENABLED') && get('TLS_MODE') === 'acme' && get('ACME_EMAIL') === '') {
    throw new ValidationError('ACME_EMAIL', 'is required when TLS_MODE is acme')
  }
  if (truthy('TAILSCALE_ENABLED') && get('TS_AUTHKEY') === '' && get('TAILSCALE_HOSTNAME') === '') {
    throw new ValidationError('TAILSCALE_HOSTNAME', 'is required when Tailscale is enabled')
  }
  if (get('DEV_GATEWAY_WEB_BIND_ADDRESS') === '0.0.0.0') {
    throw new ValidationError(
      'DEV_GATEWAY_WEB_BIND_ADDRESS',
      'the panel is not published on every interface; reach it over the VPN instead',
    )
  }
}
