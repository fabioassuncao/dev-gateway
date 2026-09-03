// Who is asking, and what they may do.
//
// Not RBAC: there is one panel credential, checked by ForwardAuth before a
// request reaches this process. What this adds is a vocabulary the routes can
// declare against — a capability per route, published in the OpenAPI document
// as x-portta-capability — and a principal per request that holds a set of
// them. Read-only mode is the principal that holds every read; an agent that
// announces itself with X-Portta-Actor holds what the operator granted it.
// See docs/adr/0032-portta-development-model.md.

import type { Context, MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import {
  ALL_CAPABILITIES,
  DEFAULT_AGENT_CAPABILITIES,
  READ_CAPABILITIES,
  readActor,
  parseApiCapabilities,
  type ApiCapability,
  type ActivitySource,
} from 'portta-core'

export type PrincipalKind = 'operator' | 'agent'

export interface Principal {
  /** The declared actor, or null for the operator who did not say. */
  actor: string | null
  kind: PrincipalKind
  actorKind: 'human' | 'agent'
  capabilities: ReadonlySet<ApiCapability>
  readOnly: boolean
  source: ActivitySource
}

export interface PrincipalSource {
  readOnly: boolean
  /** What an agent holds; resolved lazily because it is a setting in the database. */
  agentCapabilities: () => Promise<readonly ApiCapability[]>
}

const PRINCIPAL_KEY = 'portta.principal'

export function operatorPrincipal(readOnly: boolean, actor: string | null = null, source: ActivitySource = 'api'): Principal {
  return {
    actor,
    kind: 'operator',
    actorKind: 'human',
    capabilities: new Set(readOnly ? READ_CAPABILITIES : ALL_CAPABILITIES),
    readOnly,
    source,
  }
}

export function agentPrincipal(actor: string, granted: readonly ApiCapability[], readOnly: boolean, source: ActivitySource = 'api', actorKind: 'human' | 'agent' = 'agent'): Principal {
  const held = readOnly ? granted.filter((capability) => capability.endsWith(':read')) : granted
  return { actor, kind: 'agent', actorKind, capabilities: new Set(held), readOnly, source }
}

/**
 * The principal of one request.
 *
 * `X-Portta-Actor` is self-declared. It does not authenticate anything — the
 * credential did that already — it says *which* caller behind that credential
 * this is, so an agent can be held to a smaller set than the operator. The
 * operator may also declare an actor for attribution (`X-Portta-Actor-Kind:
 * human`), which keeps every capability.
 */
export async function principalFor(headers: { get(name: string): string | null | undefined }, source: PrincipalSource): Promise<Principal> {
  const actor = readActor(headers.get('X-Portta-Actor'))
  const declaredKind = (headers.get('X-Portta-Actor-Kind') ?? '').trim().toLowerCase()
  const declaredSource = (headers.get('X-Portta-Source') ?? '').trim().toLowerCase()
  const activitySource: ActivitySource = ['web', 'cli', 'mcp', 'api', 'github', 'system'].includes(declaredSource)
    ? declaredSource as ActivitySource : 'api'
  if (headers.get('X-Portta-Token-Authenticated') === 'true' && actor !== null) {
    const held = parseApiCapabilities((headers.get('X-Portta-Capabilities') ?? '').split(','))
    return agentPrincipal(actor, held, source.readOnly, activitySource, declaredKind === 'human' ? 'human' : 'agent')
  }
  if (actor === null) return operatorPrincipal(source.readOnly, null, activitySource)
  if (declaredKind === 'human') return operatorPrincipal(source.readOnly, actor, activitySource)
  const granted = await source.agentCapabilities().catch(() => DEFAULT_AGENT_CAPABILITIES)
  return agentPrincipal(actor, granted, source.readOnly, activitySource)
}

export function principalMiddleware(source: PrincipalSource): MiddlewareHandler {
  return async (c, next) => {
    c.set(PRINCIPAL_KEY, await principalFor({ get: (name) => c.req.header(name) }, source))
    await next()
  }
}

export function principalOf(c: Context): Principal {
  return (c.get(PRINCIPAL_KEY) as Principal | undefined) ?? operatorPrincipal(false)
}

export class CapabilityRefused extends HTTPException {
  readonly capability: ApiCapability

  constructor(capability: ApiCapability, principal: Principal) {
    const who = principal.kind === 'agent' ? `agent '${principal.actor}'` : 'this panel'
    super(403, {
      message: principal.readOnly && !capability.endsWith(':read')
        ? `the panel is read-only, so ${capability} is refused`
        : `${who} does not hold ${capability}`,
    })
    this.capability = capability
  }
}

/** The check a documented route makes before its handler runs. */
export function requireCapability(c: Context, capability: ApiCapability): Principal {
  const principal = principalOf(c)
  if (!principal.capabilities.has(capability)) throw new CapabilityRefused(capability, principal)
  return principal
}

export { DEFAULT_AGENT_CAPABILITIES }
