// `portta tasks`: the work, from the terminal or from an agent.
//
// Every verb is one call to the panel API, the same one the UI and `portta
// mcp` use. Nothing is computed here: what is next, what is blocked, and
// whether a write reached GitHub are the panel's answers, printed.

import type { Command } from 'commander'
import { segment } from '../api.js'
import { UsageError } from '../errors.js'
import { ago, clientFor, csv, query, requireProject, table } from './work.js'

interface TaskSummary {
  id: string; project: string; parentId: string | null; title: string; status: string; priority: string | null
  assignee: string | null; agent: string | null; repository: { id: string; name: string } | null; environment: string | null
  subtaskCount: number; openSubtaskCount: number; github: { repository: string; number: number; syncState: string } | null
  updatedAt: number; panelUrl: string
}
interface Task extends TaskSummary {
  description: string | null
  notes: { actor: string | null; body: string; createdAt: number }[]
  environments: { environment: string; source: string; running: boolean }[]
  subtasks: TaskSummary[]
  activeSessionCount: number
}

function line(task: TaskSummary): string[] {
  return [
    `#${task.id}`, task.status, task.priority ?? '-', task.assignee ?? task.agent ?? '-',
    task.github ? `${task.github.repository}#${task.github.number}${task.github.syncState === 'synced' ? '' : ` (${task.github.syncState})`}` : (task.repository?.name ?? '-'),
    task.subtaskCount > 0 ? `${task.subtaskCount - task.openSubtaskCount}/${task.subtaskCount}` : '-',
    ago(task.updatedAt), task.title,
  ]
}

function printTask(output: ReturnType<typeof clientFor>['output'], task: Task): void {
  output.line(`#${task.id}  ${task.title}`)
  output.line(`  status ${task.status} · priority ${task.priority ?? '-'} · assignee ${task.assignee ?? '-'}${task.agent ? ` · agent ${task.agent}` : ''}`)
  if (task.parentId) output.line(`  subtask of #${task.parentId}`)
  if (task.repository) output.line(`  repository ${task.repository.name}${task.environment ? ` · environment ${task.environment}` : ''}`)
  if (task.github) output.line(`  github ${task.github.repository}#${task.github.number} (${task.github.syncState})`)
  if (task.environments.length > 0) output.line(`  running in ${task.environments.map((e) => `${e.environment}${e.running ? '' : ' (stopped)'} [${e.source}]`).join(', ')}`)
  if (task.activeSessionCount > 0) output.line(`  ${task.activeSessionCount} active session(s)`)
  if (task.description) output.line(`\n${task.description.trim()}\n`)
  if (task.subtasks.length > 0) {
    output.line('  subtasks:')
    for (const subtask of task.subtasks) output.line(`    #${subtask.id}  ${subtask.status.padEnd(11)} ${subtask.title}`)
  }
  if (task.notes.length > 0) {
    output.line('  notes:')
    for (const note of task.notes) output.line(`    ${ago(note.createdAt)} ago · ${note.actor ?? '?'}: ${note.body.split('\n')[0]}`)
  }
  output.line(`  ${task.panelUrl}`)
}

export async function tasksList(options: { project?: string; status?: string; mine?: boolean; open?: boolean; assignee?: string; repository?: string; q?: string }, command: Command): Promise<void> {
  const { client, output, globals } = clientFor(command)
  const project = requireProject(options.project)
  const assignee = options.mine ? (globals.actor ?? process.env['PORTTA_ACTOR'] ?? process.env['USER']) : options.assignee
  const body = await client.request<{ tasks: TaskSummary[] }>('GET', `/projects/${segment(project)}/tasks${query({ status: csv(options.status)?.join(','), open: options.open ? 'true' : undefined, assignee, repository: options.repository, q: options.q })}`)
  if (output.json) return output.data(body)
  if (body.tasks.length === 0) return output.line('no tasks')
  table(output, [['id', 'status', 'prio', 'who', 'where', 'sub', 'age', 'title'], ...body.tasks.map(line)])
}

export async function tasksNext(options: { project?: string }, command: Command): Promise<void> {
  const { client, output } = clientFor(command)
  const body = await client.request<{ task: Task | null }>('GET', `/projects/${segment(requireProject(options.project))}/tasks/next`)
  if (output.json) return output.data(body)
  if (!body.task) return output.line('nothing to do: no ready, unblocked, unassigned task')
  printTask(output, body.task)
}

export async function tasksShow(ref: string, command: Command): Promise<void> {
  const { client, output } = clientFor(command)
  const task = await client.request<Task>('GET', `/tasks/${segment(ref)}`)
  if (output.json) return output.data(task)
  printTask(output, task)
}

export async function tasksCreate(options: { project?: string; title?: string; description?: string; priority?: string; status?: string; parent?: string; repository?: string; environment?: string; labels?: string; assignee?: string }, command: Command): Promise<void> {
  const { client, output } = clientFor(command)
  if (!options.title) throw new UsageError('--title is required')
  const task = await client.request<Task>('POST', `/projects/${segment(requireProject(options.project))}/tasks`, {
    title: options.title,
    ...(options.description !== undefined ? { description: options.description } : {}),
    ...(options.priority ? { priority: options.priority } : {}),
    ...(options.status ? { status: options.status } : {}),
    ...(options.parent ? { parentId: options.parent.replace(/^#/, '') } : {}),
    ...(options.repository ? { repositoryId: options.repository } : {}),
    ...(options.environment ? { environment: options.environment } : {}),
    ...(options.labels ? { labels: csv(options.labels) ?? [] } : {}),
    ...(options.assignee ? { assignee: options.assignee } : {}),
  })
  if (output.json) return output.data(task)
  output.progress(`created #${task.id}`)
  printTask(output, task)
}

async function verb(ref: string, path: string, body: unknown, command: Command, method: 'POST' | 'PATCH' = 'POST'): Promise<void> {
  const { client, output } = clientFor(command)
  const task = await client.request<Task>(method, `/tasks/${segment(ref)}${path}`, body)
  if (output.json) return output.data(task)
  printTask(output, task)
}

export function tasksStart(ref: string, options: { noAssign?: boolean }, command: Command): Promise<void> {
  return verb(ref, '/start', options.noAssign ? { assign: false } : {}, command)
}

export function tasksStatus(ref: string, status: string, _options: unknown, command: Command): Promise<void> {
  return verb(ref, '/status', { status }, command)
}

export function tasksFinish(ref: string, options: { close?: boolean }, command: Command): Promise<void> {
  return verb(ref, '/finish', options.close ? { close: true } : {}, command)
}

export function tasksEdit(ref: string, options: { title?: string; description?: string; priority?: string; assignee?: string; parent?: string; environment?: string; labels?: string }, command: Command): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (options.title !== undefined) patch['title'] = options.title
  if (options.description !== undefined) patch['description'] = options.description
  if (options.priority !== undefined) patch['priority'] = options.priority === 'none' ? null : options.priority
  if (options.assignee !== undefined) patch['assignee'] = options.assignee === 'none' ? null : options.assignee
  if (options.parent !== undefined) patch['parentId'] = options.parent === 'none' ? null : options.parent.replace(/^#/, '')
  if (options.environment !== undefined) patch['environment'] = options.environment === 'none' ? null : options.environment
  if (options.labels !== undefined) patch['labels'] = csv(options.labels) ?? []
  if (Object.keys(patch).length === 0) throw new UsageError('nothing to change')
  return verb(ref, '', patch, command, 'PATCH')
}

export async function tasksNote(ref: string, text: string, _options: unknown, command: Command): Promise<void> {
  const { client, output } = clientFor(command)
  const note = await client.request<{ id: string; actor: string | null; body: string }>('POST', `/tasks/${segment(ref)}/notes`, { body: text })
  if (output.json) return output.data(note)
  output.progress(`note ${note.id} added${note.actor ? ` as ${note.actor}` : ''}`)
}

export async function tasksSubtasks(ref: string, command: Command): Promise<void> {
  const { client, output } = clientFor(command)
  const body = await client.request<{ subtasks: { task: TaskSummary; children: unknown[] }[] }>('GET', `/tasks/${segment(ref)}/subtasks`)
  if (output.json) return output.data(body)
  const walk = (nodes: { task: TaskSummary; children: unknown[] }[], depth: number) => {
    for (const node of nodes) {
      output.line(`${'  '.repeat(depth)}#${node.task.id}  ${node.task.status.padEnd(11)} ${node.task.title}`)
      walk(node.children as { task: TaskSummary; children: unknown[] }[], depth + 1)
    }
  }
  if (body.subtasks.length === 0) return output.line('no subtasks')
  walk(body.subtasks, 0)
}

export function tasksLink(ref: string, issue: string, _options: unknown, command: Command): Promise<void> {
  return verb(ref, '/github/link', { issue }, command)
}

export function tasksUnlink(ref: string, command: Command): Promise<void> {
  return verb(ref, '/github/unlink', {}, command)
}

export function tasksPublish(ref: string, options: { repository?: string }, command: Command): Promise<void> {
  return verb(ref, '/github/publish', options.repository ? { repository: options.repository } : {}, command)
}

export async function tasksSync(ref: string, options: { resolve?: string }, command: Command): Promise<void> {
  if (options.resolve !== undefined && options.resolve !== 'local' && options.resolve !== 'remote') throw new UsageError('--resolve must be local or remote')
  return verb(ref, '/github/sync', options.resolve ? { resolve: options.resolve } : {}, command)
}

export async function tasksComment(ref: string, text: string, _options: unknown, command: Command): Promise<void> {
  const { client, output } = clientFor(command)
  const comment = await client.request<{ id: number; htmlUrl: string }>('POST', `/tasks/${segment(ref)}/comments`, { body: text })
  if (output.json) return output.data(comment)
  output.line(comment.htmlUrl)
}
