// `portta tasks`: the work, from the terminal or from an agent.
//
// Every verb is one call to the panel API, the same one the UI and `portta
// mcp` use. Nothing is computed here: what is next, what is blocked, and
// whether a write reached GitHub are the panel's answers, printed.

import type { Command } from 'commander'
import { readFile } from 'node:fs/promises'
import { segment } from '../api.js'
import { confirm } from '../confirm.js'
import { UsageError } from '../errors.js'
import { ago, clientFor, csv, query, requireProject, table } from './work.js'

interface TaskSummary {
  id: string; project: string; parentId: string | null; title: string; status: string; priority: string | null
  assignee: string | null; agent: string | null; repository: { id: string; name: string } | null; environment: string | null
  subtaskCount: number; openSubtaskCount: number; github: { repository: string; number: number; syncState: string } | null
  updatedAt: number; panelUrl: string
  type?: string | null; labels?: string[]; service?: string | null; dueAt?: number | null; position?: number
}
interface Task extends TaskSummary {
  description: string | null
  notes: { actor: string | null; body: string; createdAt: number }[]
  environments: { environment: string; source: string; running: boolean }[]
  subtasks: TaskSummary[]
  activeSessionCount: number
  github: (TaskSummary['github'] & { state?: string; lastSyncedAt?: number | null; lastError?: string | null }) | null
}

function line(task: TaskSummary): string[] {
  return [
    `#${task.id}`, task.status, task.priority ?? '-', task.assignee ?? task.agent ?? '-',
    task.github ? `${task.github.repository}#${task.github.number}${task.github.syncState === 'synced' ? '' : ` (${task.github.syncState})`}` : (task.repository?.name ?? '-'),
    task.subtaskCount > 0 ? `${task.subtaskCount - task.openSubtaskCount}/${task.subtaskCount}` : '-',
    ago(task.updatedAt), task.title,
  ]
}

const STATUSES = new Set(['backlog', 'ready', 'in_progress', 'review', 'blocked', 'done'])
function statusValue(value: string): string {
  const status = value.replaceAll('-', '_').replace(/^todo$/, 'ready')
  if (!STATUSES.has(status)) throw new UsageError(`unknown status '${value}'`, 'use backlog, ready, in_progress, review, blocked or done')
  return status
}

function deadlineValue(value: string): number {
  const date = new Date(`${value}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime())) throw new UsageError('--deadline must be YYYY-MM-DD or none')
  return Math.floor(date.getTime() / 1000)
}

function printTask(output: ReturnType<typeof clientFor>['output'], task: Task): void {
  output.line(`#${task.id}  ${task.title}`)
  output.line(`  status ${task.status} · priority ${task.priority ?? '-'} · assignee ${task.assignee ?? '-'}${task.agent ? ` · agent ${task.agent}` : ''}`)
  if (task.type || task.labels?.length) output.line(`  type ${task.type ?? '-'}${task.labels?.length ? ` · labels ${task.labels.join(', ')}` : ''}`)
  if (task.parentId) output.line(`  subtask of #${task.parentId}`)
  if (task.repository || task.environment || task.service) output.line(`  repository ${task.repository?.name ?? '-'}${task.environment ? ` · environment ${task.environment}` : ''}${task.service ? ` · service ${task.service}` : ''}`)
  if (task.dueAt) output.line(`  due ${new Date(task.dueAt * 1000).toISOString().slice(0, 10)}`)
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

export async function tasksList(options: { project?: string; status?: string; priority?: string; type?: string; label?: string; mine?: boolean; open?: boolean; assignee?: string; agent?: string; repository?: string; environment?: string; service?: string; parent?: string; q?: string }, command: Command): Promise<void> {
  const { client, output, globals } = clientFor(command)
  const assignee = options.mine ? (globals.actor ?? process.env['PORTTA_ACTOR'] ?? process.env['USER']) : options.assignee
  const path = options.project ? `/projects/${segment(options.project)}/tasks` : '/tasks'
  const body = await client.request<{ tasks: TaskSummary[] }>('GET', `${path}${query({ status: csv(options.status)?.join(','), priority: csv(options.priority)?.join(','), type: options.type, label: options.label, open: options.open ? 'true' : undefined, assignee, agent: options.agent, repository: options.repository, environment: options.environment, service: options.service, parent: options.parent, q: options.q })}`)
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
  if (output.json) {
    const tree = await client.request<{ subtasks: unknown }>('GET', `/tasks/${segment(ref)}/subtasks`)
    return output.data({ ...task, subtaskTree: tree.subtasks })
  }
  printTask(output, task)
}

export async function tasksDelete(ref: string, command: Command): Promise<void> {
  const { client, output, globals } = clientFor(command)
  await confirm(`delete task ${ref} and its subtasks?`, Boolean((globals as { yes?: boolean }).yes))
  const body = await client.request<{ ok: boolean; removed: string }>('DELETE', `/tasks/${segment(ref)}`)
  if (output.json) return output.data(body)
  output.progress(`deleted #${body.removed}`)
}

export async function tasksCreate(options: { project?: string; title?: string; description?: string; priority?: string; status?: string; type?: string; parent?: string; repository?: string; environment?: string; service?: string; labels?: string; assignee?: string; agent?: string; deadline?: string }, command: Command): Promise<void> {
  const { client, output } = clientFor(command)
  if (!options.title) throw new UsageError('--title is required')
  const task = await client.request<Task>('POST', `/projects/${segment(requireProject(options.project))}/tasks`, {
    title: options.title,
    ...(options.description !== undefined ? { description: options.description } : {}),
    ...(options.priority ? { priority: options.priority } : {}),
    ...(options.status ? { status: statusValue(options.status) } : {}),
    ...(options.type ? { type: options.type } : {}),
    ...(options.parent ? { parentId: options.parent.replace(/^#/, '') } : {}),
    ...(options.repository ? { repositoryId: options.repository } : {}),
    ...(options.environment ? { environment: options.environment } : {}),
    ...(options.service ? { service: options.service } : {}),
    ...(options.labels ? { labels: csv(options.labels) ?? [] } : {}),
    ...(options.assignee ? { assignee: options.assignee } : {}),
    ...(options.agent ? { agent: options.agent } : {}),
    ...(options.deadline ? { dueAt: deadlineValue(options.deadline) } : {}),
  })
  if (output.json) return output.data(task)
  output.progress(`created #${task.id}`)
  printTask(output, task)
}

async function verb(ref: string, path: string, body: unknown, command: Command, method: 'POST' | 'PATCH' | 'PUT' = 'POST'): Promise<void> {
  const { client, output } = clientFor(command)
  const task = await client.request<Task>(method, `/tasks/${segment(ref)}${path}`, body)
  if (output.json) return output.data(task)
  printTask(output, task)
}

export function tasksStart(ref: string, options: { noAssign?: boolean }, command: Command): Promise<void> {
  return verb(ref, '/start', options.noAssign ? { assign: false } : {}, command)
}

export function tasksStatus(ref: string, status: string, _options: unknown, command: Command): Promise<void> {
  return verb(ref, '/move', { status: statusValue(status) }, command)
}

export function tasksFinish(ref: string, options: { close?: boolean }, command: Command): Promise<void> {
  return verb(ref, '/finish', options.close ? { close: true } : {}, command)
}

export function tasksEdit(ref: string, options: { title?: string; description?: string; status?: string; priority?: string; type?: string; assignee?: string; agent?: string; parent?: string; repository?: string; environment?: string; service?: string; deadline?: string; labels?: string }, command: Command): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (options.title !== undefined) patch['title'] = options.title
  if (options.description !== undefined) patch['description'] = options.description
  if (options.status !== undefined) patch['status'] = statusValue(options.status)
  if (options.priority !== undefined) patch['priority'] = options.priority === 'none' ? null : options.priority
  if (options.type !== undefined) patch['type'] = options.type === 'none' ? null : options.type
  if (options.assignee !== undefined) patch['assignee'] = options.assignee === 'none' ? null : options.assignee
  if (options.agent !== undefined) patch['agent'] = options.agent === 'none' ? null : options.agent
  if (options.parent !== undefined) patch['parentId'] = options.parent === 'none' ? null : options.parent.replace(/^#/, '')
  if (options.repository !== undefined) patch['repositoryId'] = options.repository === 'none' ? null : options.repository
  if (options.environment !== undefined) patch['environment'] = options.environment === 'none' ? null : options.environment
  if (options.service !== undefined) patch['service'] = options.service === 'none' ? null : options.service
  if (options.deadline !== undefined) {
    if (options.deadline === 'none') patch['dueAt'] = null
    else {
      patch['dueAt'] = deadlineValue(options.deadline)
    }
  }
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

export function tasksSubtaskCreate(ref: string, options: { title?: string; status?: string; repository?: string }, command: Command): Promise<void> {
  if (!options.title) throw new UsageError('--title is required')
  return verb(ref, '/subtasks', { title: options.title, ...(options.status ? { status: statusValue(options.status) } : {}), ...(options.repository ? { repositoryId: options.repository } : {}) }, command)
}

export function tasksSubtaskLink(ref: string, child: string, _options: unknown, command: Command): Promise<void> {
  return verb(ref, `/subtasks/${segment(child.replace(/^#/, ''))}`, {}, command, 'PUT')
}

export async function tasksLink(ref: string, issue: string, options: { pull?: boolean; push?: boolean }, command: Command): Promise<void> {
  if (options.pull === options.push) throw new UsageError('choose exactly one initial direction: --pull or --push')
  await verb(ref, '/github/link', { issue, initialSync: options.pull ? 'pull' : 'push' }, command)
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

async function stdinText(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  return Buffer.concat(chunks).toString('utf8')
}

async function message(options: { message?: string; file?: string; stdin?: boolean }, fallback?: string): Promise<string> {
  const choices = [options.message !== undefined, options.file !== undefined, options.stdin === true, fallback !== undefined].filter(Boolean).length
  if (choices !== 1) throw new UsageError('provide exactly one of --message, --file, --stdin, or the legacy text argument')
  const text = options.file ? await readFile(options.file, 'utf8') : options.stdin ? await stdinText() : options.message ?? fallback ?? ''
  if (!text.trim()) throw new UsageError('comment cannot be empty')
  return text
}

export async function tasksComment(ref: string, text: string | undefined, options: { message?: string; file?: string; stdin?: boolean }, command: Command): Promise<void> {
  const { client, output } = clientFor(command)
  const comment = await client.request<{ id: string; actor: string | null; body: string }>('POST', `/tasks/${segment(ref)}/comments`, { body: await message(options, text) })
  if (output.json) return output.data(comment)
  output.progress(`comment ${comment.id} added${comment.actor ? ` as ${comment.actor}` : ''}`)
}

export async function tasksGitHubStatus(ref: string, command: Command): Promise<void> {
  const { client, output } = clientFor(command)
  const task = await client.request<Task>('GET', `/tasks/${segment(ref)}`)
  if (output.json) return output.data({ github: task.github })
  if (!task.github) return output.line('not linked')
  output.line(`${task.github.repository}#${task.github.number}  ${task.github.syncState}`)
  if (task.github.state) output.line(`  state ${task.github.state}`)
  if (task.github.lastSyncedAt) output.line(`  last sync ${new Date(task.github.lastSyncedAt * 1000).toISOString()}`)
  if (task.github.lastError) output.line(`  error ${task.github.lastError}`)
}
