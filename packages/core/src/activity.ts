// What happened in the development flow, as a closed vocabulary.
//
// Activity is not a log. A log answers "what is the process printing"; an
// activity event answers "what happened to this project": a task moved, a
// session started, an environment was rebuilt, a commit landed. The kinds are
// listed here so the panel, the CLI and an agent name them the same way.

export const ACTIVITY_KINDS = [
  'task.created', 'task.updated', 'task.status', 'task.assigned', 'task.note', 'task.linked', 'task.synced', 'task.conflict', 'task.deleted',
  'session.started', 'session.ended', 'session.abandoned',
  'repository.added', 'repository.removed', 'repository.commit', 'repository.branch',
  'environment.started', 'environment.stopped', 'environment.restarted', 'environment.rebuilt', 'environment.removed', 'environment.adopted',
  'service.unhealthy', 'service.recovered',
  'project.created', 'project.updated', 'project.deleted',
] as const
export type ActivityKind = (typeof ACTIVITY_KINDS)[number]

export function isActivityKind(value: string): value is ActivityKind {
  return (ACTIVITY_KINDS as readonly string[]).includes(value)
}

/** The entity an event is mostly about, for grouping and icons. */
export function activityEntity(kind: ActivityKind): 'task' | 'session' | 'repository' | 'environment' | 'service' | 'project' {
  return kind.split('.')[0] as ReturnType<typeof activityEntity>
}

export const SESSION_STATUSES = ['active', 'ended', 'abandoned'] as const
export type SessionStatus = (typeof SESSION_STATUSES)[number]

/** Retention: what "recent" means for the timeline. Pruned in code, never a cron. */
export const ACTIVITY_KEEP_DAYS = 90
export const ACTIVITY_KEEP_PER_PROJECT = 5000

/** A session with no heartbeat for this long is abandoned, not active. */
export const SESSION_ABANDON_AFTER_SECONDS = 6 * 60 * 60
