import { slug } from './namespace.ts'

/**
 * What a service is called, in one DNS label.
 *
 * Portta's original convention is `<project>-<service>.<base>`, produced by
 * Traefik's `defaultRule` and re-derived for display in three places
 * ([ADR 0005](../../../docs/adr/0005-hostname-convention.md)). It has one flaw
 * that only shows up once a name has to carry more than two parts: a single
 * `-` is also the character `slug` uses *inside* each part, so `a-b-c` cannot
 * be read back as project and service, and there is nowhere to put a third
 * component such as a branch or a pull request.
 *
 * The `service--project` style fixes that by separating components with `--`.
 * `slug` collapses runs of `-`, so no component can ever contain `--`, which
 * makes the separator unambiguous in both directions and leaves room for a
 * context:
 *
 *     web--storefront.example.com
 *     web--storefront--pr-42.example.com
 *
 * ### Why one label and not `web.storefront.example.com`
 *
 * Measured, not assumed. Cloudflare's Universal SSL covers the apex and
 * **first-level subdomains only**; `web.storefront.example.com` is a second
 * level and needs Advanced Certificate Manager, a paid add-on. The same holds
 * for the automatic domains: a certificate for `*.1-2-3-4.sslip.io` cannot
 * cover `web.demo.1-2-3-4.sslip.io`. Keeping the whole name in one label means
 * a single wildcard — one the operator already has — covers every project this
 * gateway will ever route.
 *
 * See docs/adr/0023-flat-hostname-labels.md.
 */

export const HOSTNAME_STYLES = ['project-service', 'service--project'] as const
export type HostnameStyle = (typeof HOSTNAME_STYLES)[number]

export function isHostnameStyle(value: string): value is HostnameStyle {
  return (HOSTNAME_STYLES as readonly string[]).includes(value)
}

/** A single DNS label may not exceed 63 octets (RFC 1035). */
export const MAX_LABEL = 63
/** A whole domain name may not exceed 253 characters (RFC 1035). */
export const MAX_HOSTNAME = 253

export const COMPONENT_SEPARATOR = '--'

export interface HostLabelParts {
  project: string
  service: string
  /** Branch, pull request, preview — anything that distinguishes one run. */
  context?: string | null
}

/**
 * A short, stable digest, used only to keep two long names apart.
 *
 * FNV-1a: four lines, no dependency, and no cryptographic claim — the only
 * property needed is that two different inputs rarely collide, which for the
 * handful of names one gateway serves is comfortably enough.
 */
export function shortHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36).padStart(6, '0').slice(-6)
}

/**
 * Trim a label to fit, keeping a digest of what was removed.
 *
 * A label that is simply cut loses the part that made it distinct — two long
 * branch names would collapse onto the same hostname and silently route to
 * whichever container Traefik matched first. Replacing the tail with a digest
 * of the *whole* original keeps them apart.
 */
export function fitLabel(label: string, limit = MAX_LABEL): string {
  if (label.length <= limit) return label
  const digest = shortHash(label)
  const keep = limit - digest.length - 1
  return `${label.slice(0, keep).replace(/-+$/, '')}-${digest}`
}

/**
 * The label a service answers on, before the base domain.
 *
 * Every component is slugged first, so an input like `feature/auth/login`
 * becomes `feature-auth-login` and can never introduce a stray `--` that would
 * be read back as a component boundary.
 */
export function hostLabel(parts: HostLabelParts, style: HostnameStyle = 'project-service'): string {
  const project = slug(parts.project)
  const service = slug(parts.service)
  const context = parts.context ? slug(parts.context) : ''

  if (style === 'project-service') {
    // The original convention, kept exactly as Traefik's defaultRule produces
    // it so that no existing URL changes. It has no room for a context, so one
    // is appended with the unambiguous separator when there is one.
    const base = service ? `${project}-${service}` : project
    return fitLabel(context ? `${base}${COMPONENT_SEPARATOR}${context}` : base)
  }

  const components = [service, project]
  if (context) components.push(context)
  return fitLabel(components.filter(Boolean).join(COMPONENT_SEPARATOR))
}

/**
 * Read a label back into its components.
 *
 * Only `service--project` is unambiguous: in `project-service` the separator
 * is the same character that appears inside each component, so the split
 * cannot be trusted and this returns null rather than guessing wrong.
 */
export function parseHostLabel(label: string, style: HostnameStyle = 'service--project'): HostLabelParts | null {
  if (style !== 'service--project') return null
  const parts = label.split(COMPONENT_SEPARATOR).filter(Boolean)
  if (parts.length < 2) return null
  const [service, project, context] = parts
  if (!service || !project) return null
  return { project, service, context: context ?? null }
}

/** The full hostname, label plus base, refusing one that cannot exist. */
export function hostnameFor(parts: HostLabelParts, domain: string, style: HostnameStyle = 'project-service'): string {
  const hostname = `${hostLabel(parts, style)}.${domain}`
  if (hostname.length > MAX_HOSTNAME) {
    throw new Error(`hostname is ${hostname.length} characters, over the ${MAX_HOSTNAME} the DNS allows: ${hostname}`)
  }
  return hostname
}

/** The hostname the Traefik dashboard is advertised on. Never hardcoded. */
export function dashboardAdvertisedHost(
  project: string,
  domain: string,
  style: HostnameStyle = 'project-service',
): string {
  return hostnameFor({ project, service: 'traefik' }, domain, style)
}

/**
 * The Traefik `defaultRule` template that produces this style.
 *
 * Traefik bakes this into every router that declares no rule of its own, at
 * container start ([ADR 0003](../../../docs/adr/0003-traefik-static-config-via-env.md)),
 * which is why the style is a gateway setting and not a per-project one: the
 * two implementations of this contract must generate the same names, and there
 * is only one rule in force at a time.
 */
export function defaultRuleTemplate(domain: string, style: HostnameStyle = 'project-service'): string {
  const project = '{{ normalize (index .Labels "com.docker.compose.project") }}'
  const service = '{{ normalize (index .Labels "com.docker.compose.service") }}'
  const fallback = '{{ normalize .Name }}'
  const label =
    style === 'service--project'
      ? `${service}${COMPONENT_SEPARATOR}${project}`
      : `${project}-${service}`
  return `Host(\`{{ if index .Labels "com.docker.compose.project" }}${label}{{ else }}${fallback}{{ end }}.${domain}\`)`
}
