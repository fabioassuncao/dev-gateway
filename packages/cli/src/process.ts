import { spawn } from 'node:child_process'
import { execa, type Options } from 'execa'

export interface RunOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  input?: string | Uint8Array
  reject?: boolean
  stdio?: 'inherit' | 'pipe'
  /** Kill the process after this many milliseconds. Used for optional probes. */
  timeout?: number
}

export interface ProcessResult {
  stdout: string
  stderr: string
  exitCode: number
  failed: boolean
}

/** The only process primitive in the CLI: executable plus argument array, never a shell string. */
export async function runProcess(file: string, args: readonly string[] = [], options: RunOptions = {}): Promise<ProcessResult> {
  const execaOptions: Options = {
    cwd: options.cwd,
    env: options.env,
    input: options.input as string | undefined,
    reject: options.reject ?? true,
    shell: false,
    stdio: options.stdio ?? 'pipe',
    timeout: options.timeout,
  }
  const result = await execa(file, [...args], execaOptions)
  return {
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
    exitCode: result.exitCode ?? (result.failed ? 1 : 0),
    failed: result.failed,
  }
}

export const PROCESS_POLICY = Object.freeze({ shell: false, argumentArraysOnly: true })

/**
 * Start a process that must outlive this command.
 *
 * The only caller is `remote access open`, which leaves an SSH tunnel running
 * after the CLI exits — the whole point of the command is a local address that
 * still answers once the terminal is free. Detached and unreferenced, with its
 * output discarded, because a background process writing to a closed terminal
 * is how a tunnel dies silently.
 *
 * Still an argument array and still no shell: the exception is the lifetime,
 * not the policy.
 */
export function spawnDetached(file: string, args: readonly string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): number | undefined {
  const child = spawn(file, [...args], {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  return child.pid
}
