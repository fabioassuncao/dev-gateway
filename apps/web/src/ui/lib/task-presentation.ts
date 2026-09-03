// How a task looks: tones and columns, once.

import { statusDefinition } from 'portta-core'
import type { TaskPriority, TaskStatus, TaskSyncState } from '../../shared/task-types.ts'

/** What a board column needs to say: which status it holds. */
export interface ColumnLike {
  status: TaskStatus | null
}

export type Tone = 'neutral' | 'info' | 'ok' | 'warn' | 'danger' | 'accent' | 'outline'

export function priorityTone(priority: TaskPriority | string | null | undefined): Tone {
  switch (priority) {
    case 'urgent':
      return 'danger'
    case 'high':
      return 'warn'
    default:
      return 'neutral'
  }
}

export function statusTone(status: TaskStatus | string | null | undefined): Tone {
  return (status ? statusDefinition(status)?.tone : undefined) as Tone | undefined ?? 'neutral'
}

export function syncTone(state: TaskSyncState | null | undefined): Tone {
  switch (state) {
    case 'synced':
      return 'ok'
    case 'pending':
      return 'warn'
    case 'conflict':
    case 'error':
      return 'danger'
    default:
      return 'neutral'
  }
}

/** A task with no status, or one no column claims, lands in the first column. */
export function columnFor<C extends ColumnLike>(task: { status: TaskStatus | null }, columns: readonly C[]): C {
  return columns.find((column) => column.status === task.status) ?? columns[0]!
}
