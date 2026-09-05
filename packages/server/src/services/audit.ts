// What was done, by whom, to what.
//
// Not a log and not a work record: `activity_events` already says what happened
// in the development flow, and tasks and sessions belong there. This is the
// sensitive writes — who signed in, who changed a role, who destroyed an
// environment — so an operator can answer "who did that" months later.
//
// The writer is phase 12's; this is the read the Settings page needs, and the
// action vocabulary both halves agree on (03 §9).

import { and, desc, eq, lt } from 'drizzle-orm'
import { auditLog, projects as projectsTable, type Db } from 'portta-db'
import type { AuditAction } from 'portta-core'

export type { AuditAction }

export interface AuditEntry {
  id: string
  at: number
  /** Null once the account is removed; `userEmail` keeps the line readable. */
  userId: string | null
  userEmail: string | null
  principalKind: 'local' | 'user' | 'token'
  actor: string
  action: AuditAction
  resourceType: string
  resourceId: string | null
  resourceName: string | null
  project: string | null
  ipAddress: string | null
  metadata: Record<string, unknown>
}

export interface AuditQuery {
  limit?: number
  /** An id; only entries older than it, for paging. */
  before?: string
  userId?: string
  projectId?: number
  action?: AuditAction
}

/**
 * The entries, newest first.
 *
 * Read straight from the table rather than through a repository: the audit log
 * is one shape with one query, and a repository over it would be a layer with
 * one method in it.
 */
export async function listAudit(db: Db, query: AuditQuery = {}): Promise<{ entries: AuditEntry[]; nextBefore: string | null }> {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 500)
  const filters = [
    ...(query.before ? [lt(auditLog.id, Number(query.before))] : []),
    ...(query.userId ? [eq(auditLog.userId, query.userId)] : []),
    ...(query.projectId ? [eq(auditLog.projectId, query.projectId)] : []),
    ...(query.action ? [eq(auditLog.action, query.action)] : []),
  ]

  const rows = await db
    .select({ entry: auditLog, projectSlug: projectsTable.slug })
    .from(auditLog)
    .leftJoin(projectsTable, eq(projectsTable.id, auditLog.projectId))
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(auditLog.id))
    // One more than asked for, so "is there another page" is an answer rather
    // than a second count query.
    .limit(limit + 1)

  const page = rows.slice(0, limit)
  return {
    entries: page.map((row) => ({
      id: String(row.entry.id),
      at: Math.floor(row.entry.at.getTime() / 1000),
      userId: row.entry.userId,
      userEmail: row.entry.userEmail,
      principalKind: row.entry.principalKind,
      actor: row.entry.actor,
      action: row.entry.action as AuditAction,
      resourceType: row.entry.resourceType,
      resourceId: row.entry.resourceId,
      resourceName: row.entry.resourceName,
      project: row.projectSlug,
      ipAddress: row.entry.ipAddress,
      metadata: row.entry.metadata,
    })),
    nextBefore: rows.length > limit ? String(page.at(-1)?.entry.id ?? '') : null,
  }
}
