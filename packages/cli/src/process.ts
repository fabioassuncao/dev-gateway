import { execa, type Options } from 'execa'

export interface RunOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  input?: string | Uint8Array
  reject?: boolean
  stdio?: 'inherit' | 'pipe'
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
