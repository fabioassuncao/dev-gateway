// Declarative task documents for example projects (and later, portable import).
//
// References are names, never database ids. The panel resolves them at apply
// time. `key` is the stable identity across runs (stored as source_key).

import { z } from 'zod'
import { TASK_PRIORITIES, TASK_STATUSES } from './tasks.ts'

const PortableKey = z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9._-]*$/i)

const ExampleComment = z.object({
  key: PortableKey,
  actor: z.string().min(1).max(64),
  actorKind: z.enum(['human', 'agent', 'system']).optional(),
  body: z.string().min(1).max(65536),
}).strict()
export type ExampleComment = z.infer<typeof ExampleComment>

/** Declared first so the schema can nest `subtasks` without a circular infer. */
export type ExampleTask = {
  key: string
  title: string
  description?: string | null
  status?: (typeof TASK_STATUSES)[number]
  priority?: (typeof TASK_PRIORITIES)[number] | null
  type?: string | null
  labels?: string[]
  assignee?: string | null
  agent?: string | null
  repository?: string | null
  environment?: string | null
  service?: string | null
  dueAt?: string | null
  parent?: string | null
  comments?: ExampleComment[]
  subtasks?: ExampleTask[]
}

export const ExampleTask: z.ZodType<ExampleTask> = z.lazy(() => z.object({
  key: PortableKey,
  title: z.string().min(1).max(200),
  description: z.string().max(65536).nullable().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).nullable().optional(),
  type: z.string().max(32).nullable().optional(),
  labels: z.array(z.string().min(1).max(64)).max(32).optional(),
  assignee: z.string().max(64).nullable().optional(),
  agent: z.string().max(64).nullable().optional(),
  repository: z.string().min(1).max(128).nullable().optional(),
  environment: z.string().min(1).max(255).nullable().optional(),
  service: z.string().max(64).nullable().optional(),
  dueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}(T[\d:.+-Z]+)?$/).nullable().optional(),
  parent: PortableKey.nullable().optional(),
  comments: z.array(ExampleComment).max(32).optional(),
  subtasks: z.array(ExampleTask).max(32).optional(),
}).strict())

export const ExampleRepository = z.object({
  key: PortableKey,
  name: z.string().min(1).max(128),
  role: z.string().max(32).nullable().optional(),
}).strict()
export type ExampleRepository = z.infer<typeof ExampleRepository>

export const ExampleDocument = z.object({
  schemaVersion: z.literal(1),
  project: z.object({
    slug: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/),
    name: z.string().min(1).max(120),
    description: z.string().max(2000).nullable().optional(),
  }).strict(),
  repositories: z.array(ExampleRepository).max(32).optional(),
  tasks: z.array(ExampleTask).max(64),
}).strict()
export type ExampleDocument = z.infer<typeof ExampleDocument>

export const EXAMPLE_MANIFEST_NAME = 'portta.example.json'

/** Flatten nested `subtasks` into a list with `parent` keys filled in. */
export function flattenExampleTasks(tasks: readonly ExampleTask[], parent: string | null = null): ExampleTask[] {
  const out: ExampleTask[] = []
  for (const task of tasks) {
    const { subtasks, ...rest } = task
    out.push({ ...rest, parent: rest.parent ?? parent })
    if (subtasks && subtasks.length > 0) out.push(...flattenExampleTasks(subtasks, task.key))
  }
  return out
}
