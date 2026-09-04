// The one decision, in one function.
//
// A route says which permission it needs; a service says which project the
// resource belongs to. `authorize` answers, and it is the only thing that does
// — a second implementation of this is a second answer to "may I", and one of
// them will be wrong.

import type { Permission, Role } from './access-control.ts'
import type { ActivitySource } from 'portta-core'

export type PrincipalKind = 'local' | 'user' | 'token'

export interface Principal {
  kind: PrincipalKind
  /** Null only for `local`, where there is no account behind the request. */
  userId: string | null
  name: string
  email: string | null
  role: Role
  permissions: ReadonlySet<Permission>
  /** `all` for owner/admin and for `local`; otherwise the ids in project_members. */
  scope: 'all' | ReadonlySet<number>
  /** Attribution: the user's name, a token's declared actor, or X-Portta-Actor. */
  actor: string
  actorKind: 'human' | 'agent'
  source: ActivitySource
  sessionId: string | null
  tokenId: string | null
}

/** Which project a resource belongs to. Absent means the resource is global. */
export interface Scope {
  /** `null` is an environment no Project adopted: visible only to `scope: 'all'`. */
  projectId?: number | null
}

export class Unauthenticated extends Error {
  readonly status = 401

  constructor(message = 'this request carries no credential') {
    super(message)
    this.name = 'Unauthenticated'
  }
}

export class Forbidden extends Error {
  readonly status = 403
  readonly permission: Permission
  readonly scope: Scope | undefined

  constructor(permission: Permission, scope?: Scope) {
    super(
      scope?.projectId === undefined
        ? `this request needs ${permission}`
        : `this request needs ${permission} on that project`,
    )
    this.name = 'Forbidden'
    this.permission = permission
    this.scope = scope
  }
}

export function can(principal: Principal, permission: Permission, scope?: Scope): boolean {
  if (!principal.permissions.has(permission)) return false
  // A global resource: the permission alone decides.
  if (scope?.projectId === undefined) return true
  if (principal.scope === 'all') return true
  // An environment nothing adopted has no project to be a member of, so only
  // somebody who sees everything sees it.
  if (scope.projectId === null) return false
  return principal.scope.has(scope.projectId)
}

export function authorize(principal: Principal | null, permission: Permission, scope?: Scope): Principal {
  if (!principal) throw new Unauthenticated()
  if (!can(principal, permission, scope)) throw new Forbidden(permission, scope)
  return principal
}

/**
 * Whether a Project is visible at all.
 *
 * Listings filter rather than refuse: a developer asking for the projects sees
 * theirs, not a 403. `authorize` is for reaching a named one.
 */
export function sees(principal: Principal, projectId: number): boolean {
  return principal.scope === 'all' || principal.scope.has(projectId)
}
