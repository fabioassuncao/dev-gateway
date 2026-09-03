import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROCESS_POLICY, describeCommand, effectiveStdio, runProcess, setProcessReporter } from './process.js'

const NODE = process.execPath

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  setProcessReporter({})
})

describe('process execution', () => {
  it('forbids shell command construction by policy', () => expect(PROCESS_POLICY).toEqual({ shell: false, argumentArraysOnly: true }))
  it('passes metacharacters as data', async () => {
    const marker = `portta-${Date.now()}`
    const result = await runProcess(NODE, ['-e', 'process.stdout.write(process.argv[1])', `; touch /tmp/${marker}`])
    expect(result.stdout).toBe(`; touch /tmp/${marker}`)
  })
})

describe('what a child does with its output', () => {
  it('captures a piped child without showing it', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const result = await runProcess(NODE, ['-e', 'process.stdout.write("captured")'])
    expect(result.stdout).toBe('captured')
    expect(stdout).not.toHaveBeenCalled()
  })

  it('streams and captures at the same time, so a caller that parses stdout still works', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const result = await runProcess(NODE, ['-e', 'process.stdout.write("both")'], { stdio: 'stream' })
    expect(result.stdout).toBe('both')
    expect(stdout).toHaveBeenCalled()
  })

  it('keeps a streaming child off stdout under --json, and still mirrors its stderr', async () => {
    // `docker pull` writes layer progress to stdout; under --json that would
    // land in the middle of the document a machine is reading.
    setProcessReporter({ json: true })
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const result = await runProcess(NODE, ['-e', 'process.stdout.write("out");process.stderr.write("err")'], { stdio: 'stream' })
    expect(result.stdout).toBe('out')
    expect(stdout).not.toHaveBeenCalled()
    expect(stderr).toHaveBeenCalled()
  })

  it('sends input to a streaming child as well as a piped one', async () => {
    const result = await runProcess(NODE, ['-e', 'process.stdin.pipe(process.stdout)'], { input: 'echoed', stdio: 'stream' })
    expect(result.stdout).toBe('echoed')
  })
})

describe('which mode a child actually gets', () => {
  it('leaves an explicit hand-over of the terminal alone', () => {
    setProcessReporter({ verbose: true, quiet: true })
    expect(effectiveStdio('inherit')).toBe('inherit')
  })

  it('streams every piped child under --verbose', () => {
    setProcessReporter({ verbose: true })
    expect(effectiveStdio('pipe')).toBe('stream')
  })

  it('silences a streaming child under --quiet', () => {
    setProcessReporter({ quiet: true })
    expect(effectiveStdio('stream')).toBe('pipe')
  })

  it('changes nothing by default', () => {
    setProcessReporter({})
    expect(effectiveStdio('pipe')).toBe('pipe')
    expect(effectiveStdio('stream')).toBe('stream')
  })
})

describe('naming a command in one line', () => {
  it('drops the compose overlay paths that would bury the verb', () => {
    expect(describeCommand('docker', [
      'compose', '-f', 'docker/compose/compose.yaml', '-f', 'docker/compose/features/web.yaml',
      'run', '--rm', '--no-deps', '--build', '--user', '501:20', 'portta-auth-migrate',
    ])).toBe('docker compose run --rm --no-deps --build --user 501:20 portta-auth-migrate')
  })

  it('truncates rather than letting one line become a paragraph', () => {
    const described = describeCommand('git', ['-C', '/tmp', 'log', 'x'.repeat(200)])
    expect(described).toHaveLength(88)
    expect(described.endsWith('…')).toBe(true)
  })
})

describe('the heartbeat under a silent child', () => {
  /** Runs a child that outlives the first heartbeat, with the clock driven. */
  async function outlast(): Promise<string[]> {
    const lines: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((value) => {
      lines.push(String(value))
      return true
    })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const running = runProcess(NODE, ['-e', 'setTimeout(() => {}, 400)'])
    await vi.advanceTimersByTimeAsync(11_000)
    await running
    return lines
  }

  it('says a swallowed child is still running, and for how long', async () => {
    setProcessReporter({})
    const lines = await outlast()
    expect(lines.join('')).toMatch(/still running: .*node .*\(10s\)/)
  })

  it('says nothing under --quiet', async () => {
    setProcessReporter({ quiet: true })
    expect(await outlast()).toEqual([])
  })

  it('says nothing for a child that finishes promptly', async () => {
    setProcessReporter({})
    const lines: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((value) => {
      lines.push(String(value))
      return true
    })
    await runProcess(NODE, ['-e', 'process.exit(0)'])
    expect(lines).toEqual([])
  })

  it('leaves a child that is already writing to the terminal to speak for itself', async () => {
    setProcessReporter({})
    const lines: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((value) => {
      lines.push(String(value))
      return true
    })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const running = runProcess(NODE, ['-e', 'setTimeout(() => {}, 400)'], { stdio: 'stream' })
    await vi.advanceTimersByTimeAsync(11_000)
    await running
    expect(lines.join('')).not.toContain('still running')
  })
})
