// The API's half of authorisation.
//
// Two middlewares: one that decides who is asking, once per request, and one a
// route attaches to say what it needs. Nothing else in the API layer talks to
// this package.

import type { Context, MiddlewareHandler } from 'hono'
import { authorize, Unauthenticated, type Principal } from './authorize.ts'
import type { Permission } from './access-control.ts'
import type { PrincipalResolver } from './principal.ts'

declare module 'hono' {
  interface ContextVariableMap {
    principal: Principal
  }
}

export interface PrincipalMiddlewareOptions {
  resolver: PrincipalResolver
  /**
   * `METHOD /path` for the routes that answer without a credential: liveness,
   * the auth status, the setup endpoint while it is still open, and the GitHub
   * webhook, which carries an HMAC instead.
   */
  publicRoutes: ReadonlySet<string>
  /** Whether the panel is still waiting for its first user. */
  setupRequired?: () => Promise<boolean>
}

export class SetupRequired extends Error {
  readonly status = 503

  constructor() {
    super('this panel has no owner yet; open /setup')
    this.name = 'SetupRequired'
  }
}

export function principalMiddleware(options: PrincipalMiddlewareOptions): MiddlewareHandler {
  return async (c, next) => {
    const key = `${c.req.method} ${c.req.path}`
    if (options.publicRoutes.has(key)) return next()

    // A panel with no owner answers nothing but the three public routes: every
    // other answer would be about a host nobody has proved they may see.
    if (options.setupRequired && (await options.setupRequired())) throw new SetupRequired()

    const principal = await options.resolver.fromHeaders(c.req.raw.headers)
    if (!principal) throw new Unauthenticated()
    c.set('principal', principal)
    await next()
  }
}

/**
 * What this route needs, without a scope.
 *
 * The scope comes later, in the handler or the service, once the resource has
 * been read and the Project it belongs to is known. Checking the permission
 * first means a `viewer` never reaches the query.
 */
export function requirePermission(permission: Permission): MiddlewareHandler {
  return async (c, next) => {
    authorize(c.get('principal') ?? null, permission)
    await next()
  }
}

export function principalOf(c: Context): Principal {
  const principal = c.get('principal')
  if (!principal) throw new Unauthenticated()
  return principal
}
