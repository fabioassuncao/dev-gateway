// What a caller of the panel's API may do.
//
// Not RBAC: there is one operator credential and, optionally, agents that
// announce themselves with `X-Portta-Actor`. What this gives the API is a
// vocabulary — every route declares the capability it needs, the OpenAPI
// document publishes it, and the principal attached to a request carries the
// set it holds. Read-only mode and an agent's default set are both expressed
// in that vocabulary rather than as special cases in route code.

export const API_CAPABILITIES = [
  'project:read', 'project:write',
  'repository:read', 'repository:write',
  'task:read', 'task:write', 'task:sync',
  'environment:read', 'environment:operate', 'environment:destroy',
  'service:read',
  'logs:read',
  'access:open', 'access:write',
  'metrics:read',
  'activity:read',
  'session:write',
  'gateway:read', 'gateway:operate',
  'config:read', 'config:write',
  'docker:read', 'docker:operate', 'docker:destroy',
  'github:read', 'github:sync',
] as const

export type ApiCapability = (typeof API_CAPABILITIES)[number]

export function isApiCapability(value: string): value is ApiCapability {
  return (API_CAPABILITIES as readonly string[]).includes(value)
}

/** Everything that only reads. This is what read-only mode grants. */
export const READ_CAPABILITIES: readonly ApiCapability[] = API_CAPABILITIES.filter((capability) => capability.endsWith(':read'))

/**
 * What an agent holds unless the operator says otherwise: it may work
 * (tasks, sessions, starting and stopping what it runs) but not destroy,
 * reconfigure the gateway, or open a network path.
 */
export const DEFAULT_AGENT_CAPABILITIES: readonly ApiCapability[] = API_CAPABILITIES.filter((capability) =>
  !capability.endsWith(':destroy') &&
  capability !== 'access:write' &&
  capability !== 'config:write' &&
  capability !== 'gateway:operate')

export const ALL_CAPABILITIES: readonly ApiCapability[] = API_CAPABILITIES

export function hasApiCapability(held: ReadonlySet<ApiCapability> | readonly ApiCapability[], needed: ApiCapability): boolean {
  return held instanceof Set ? held.has(needed) : (held as readonly ApiCapability[]).includes(needed)
}

/**
 * A stored list, coerced. Unknown names are dropped rather than refused, so a
 * setting written by a newer panel does not lock an older one out.
 */
export function parseApiCapabilities(raw: unknown): ApiCapability[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<ApiCapability>()
  for (const entry of raw) {
    if (typeof entry === 'string' && isApiCapability(entry)) seen.add(entry)
  }
  return [...seen]
}
