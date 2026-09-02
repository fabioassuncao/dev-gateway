// `portta mcp`: the task verbs, spoken to an agent over stdio.
//
// A thin adapter and nothing more. Every tool is one call to one endpoint; no
// tool composes two, because a workflow that needs composing composes in the
// API, where it can be tested without a transport. If a tool here ever grows a
// second request, that is the signal to add a verb to the API instead.
//
// It lives in the CLI rather than the panel for two reasons. The panel's
// dependency budget (ADR 0018 §9) exists because the panel may be reachable
// over a VPN, and this needs a large SDK; and `docs/monorepo.md` puts anything
// that holds no persistent decision outside the API. An MCP server holds no
// state and needs no database.
//
// **The agent never holds a GitHub credential.** It gets stdio to this process;
// this process gets a panel URL and, when the panel is authenticated, a panel
// credential. The GitHub private key stays a file the panel mounts read-only,
// and an installation token lives for an hour in the panel's memory.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import type { Command } from 'commander'
import { gatewayContext } from '../context.js'
import { PreconditionError, RefusedError } from '../errors.js'
import { CLI_VERSION } from '../version.js'

function globals(command: Command) { return command.optsWithGlobals() as { json?: boolean; yes?: boolean; quiet?: boolean; verbose?: boolean; profile?: string } }

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

export function isLoopbackUrl(raw: string): boolean {
  try {
    return LOOPBACK.has(new URL(raw).hostname)
  } catch {
    return false
  }
}

/**
 * Where the panel is, and whether we are allowed to send a credential there.
 *
 * The failure worth designing for is a misconfigured URL sending a panel
 * credential somewhere unintended, so a non-loopback panel is refused unless
 * the operator says so explicitly — which is how the rest of Portta treats
 * exposure.
 */
export function resolvePanelUrl(
  env: Record<string, string | undefined>,
  options: { url?: string; allowRemote?: boolean },
  fallbackPort: string,
): string {
  const raw = options.url ?? env['PORTTA_PANEL_URL'] ?? `http://127.0.0.1:${fallbackPort}`
  const url = raw.replace(/\/+$/, '')
  if (!isLoopbackUrl(url) && !options.allowRemote) {
    throw new RefusedError(
      `refusing to send a panel credential to ${url}`,
      'pass --allow-remote if that is deliberate; the panel is loopback by default for this reason',
    )
  }
  return url
}

/** The panel credential, when the panel is authenticated. Never logged. */
export function panelHeaders(env: Record<string, string | undefined>, actor: string): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'X-Portta-Actor': actor }
  const user = env['PORTTA_WEB_AUTH_USER']
  const password = env['PORTTA_PANEL_PASSWORD']
  if (user && password) {
    headers['authorization'] = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`
  }
  return headers
}

/**
 * The shape every tool answers with. Widened to the SDK's own result type at
 * the registration boundary rather than in every handler, so the handlers stay
 * readable and one cast carries the whole adapter.
 */
export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

type SdkToolResult = Awaited<ReturnType<Parameters<McpServer['registerTool']>[2]>>
const asSdkResult = (result: Promise<ToolResult>) => result as Promise<SdkToolResult>

/**
 * How an API answer becomes a tool result.
 *
 * An agent needs to tell "you asked for something impossible" from "try again
 * later", so the panel's status codes are carried through as words rather than
 * flattened into one failure. 503 in particular is temporary by construction:
 * it is what a GitHub outage or an exhausted rate limit looks like.
 */
export function describeFailure(status: number, body: string): string {
  const detail = body.trim() || '(no detail)'
  if (status === 400) return `refused: ${detail}`
  if (status === 401 || status === 403) return `not permitted: ${detail}`
  if (status === 404) return `not found: ${detail}`
  if (status === 503) return `temporarily unavailable, and worth retrying: ${detail}`
  return `the panel answered ${status}: ${detail}`
}

export interface ApiCaller {
  (method: 'GET' | 'POST', path: string, body?: unknown): Promise<ToolResult>
}

export function createCaller(url: string, headers: Record<string, string>, timeoutMs = 15_000): ApiCaller {
  return async (method, path, body) => {
    let response: Response
    try {
      response = await fetch(`${url}/api${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      return {
        content: [{ type: 'text', text: `the panel at ${url} did not answer: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      }
    }
    const text = await response.text()
    if (!response.ok) {
      return { content: [{ type: 'text', text: describeFailure(response.status, text) }], isError: true }
    }
    return { content: [{ type: 'text', text }] }
  }
}

/** `owner/repo#number` has to survive a path segment. */
function ref(value: string): string {
  return encodeURIComponent(value)
}

const REF = z.string().min(1).describe('The task, as `owner/repo#number` or as its projected id.')
const WORKSPACE = z.string().min(1).describe('The workspace slug.')

/**
 * One tool per verb, named for what an agent asks. Registered here so the list
 * can be asserted without starting a transport.
 */
export function registerTools(server: McpServer, call: ApiCaller): void {
  server.registerTool('list_tasks', {
    title: 'List tasks',
    description: "Every task in a workspace, from the projection. Answers while GitHub is unreachable; each row carries syncedAt and a staleness flag.",
    inputSchema: { workspace: WORKSPACE },
  }, async ({ workspace }) => asSdkResult(call('GET', `/workspaces/${ref(workspace)}/tasks`)))

  server.registerTool('next_task', {
    title: 'The task to do next',
    description: 'The highest-priority ready task that is unblocked by its sub-issues and not assigned to somebody else. Returns null when there is nothing to do, which is an answer rather than an error.',
    inputSchema: { workspace: WORKSPACE },
  }, async ({ workspace }) => asSdkResult(call('GET', `/workspaces/${ref(workspace)}/tasks/next`)))

  server.registerTool('get_task', {
    title: 'Get one task',
    description: 'One task with its sub-issue links and the environments it is being worked in.',
    inputSchema: { task: REF },
  }, async ({ task }) => asSdkResult(call('GET', `/tasks/${ref(task)}`)))

  server.registerTool('get_subtasks', {
    title: 'The sub-issue graph under a task',
    inputSchema: { task: REF },
  }, async ({ task }) => asSdkResult(call('GET', `/tasks/${ref(task)}/subtasks`)))

  server.registerTool('start_task', {
    title: 'Take a task',
    description: 'Moves it to in_progress and assigns you, in one confirmed write, so a task is never half-taken.',
    inputSchema: { task: REF, assign: z.boolean().optional().describe('Assign the actor. Default true.') },
  }, async ({ task, assign }) => asSdkResult(call('POST', `/tasks/${ref(task)}/start`, assign === undefined ? {} : { assign })))

  server.registerTool('set_task_status', {
    title: 'Move a task to one workflow status',
    inputSchema: {
      task: REF,
      status: z.enum(['backlog', 'ready', 'in_progress', 'review', 'blocked', 'done']),
    },
  }, async ({ task, status }) => asSdkResult(call('POST', `/tasks/${ref(task)}/status`, { status })))

  server.registerTool('comment_task', {
    title: 'Comment on a task',
    description: 'Posts straight to GitHub and returns what GitHub returned. Comments are never projected, so reading a discussion is a link to GitHub.',
    inputSchema: { task: REF, body: z.string().min(1).describe('Markdown, as GitHub renders it.') },
  }, async ({ task, body }) => asSdkResult(call('POST', `/tasks/${ref(task)}/comments`, { body })))

  server.registerTool('finish_task', {
    title: 'Finish a task',
    description: 'Moves it to done and, when close is true, closes the issue.',
    inputSchema: { task: REF, close: z.boolean().optional().describe('Close the issue as well. Default false.') },
  }, async ({ task, close }) => asSdkResult(call('POST', `/tasks/${ref(task)}/finish`, close === undefined ? {} : { close })))
}

/** The tool names, in the order they are registered. Asserted by a test. */
export const TOOL_NAMES = [
  'list_tasks', 'next_task', 'get_task', 'get_subtasks',
  'start_task', 'set_task_status', 'comment_task', 'finish_task',
] as const

export interface McpOptions {
  url?: string
  allowRemote?: boolean
  actor?: string
}

export async function mcpCommand(options: McpOptions, command: Command): Promise<void> {
  const context = gatewayContext({ profile: globals(command).profile, required: false })
  const url = resolvePanelUrl(context.env, options, context.env['PORTTA_WEB_PORT'] ?? '8081')
  const actor = options.actor ?? context.env['PORTTA_MCP_ACTOR'] ?? 'agent'

  // stdout is the transport. Anything written there that is not a protocol
  // message corrupts the session, which is why nothing in this command prints.
  const server = new McpServer({ name: 'portta', version: CLI_VERSION })
  registerTools(server, createCaller(url, panelHeaders(context.env, actor)))

  try {
    await server.connect(new StdioServerTransport())
  } catch (error) {
    throw new PreconditionError(
      `the MCP transport could not start: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
