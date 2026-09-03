export interface OutputOptions { json?: boolean; quiet?: boolean; verbose?: boolean }

export class Output {
  private readonly options: OutputOptions
  constructor(options: OutputOptions = {}) { this.options = options }

  data(value: unknown): void {
    if (this.options.json) process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
    else if (typeof value === 'string') process.stdout.write(`${value}${value.endsWith('\n') ? '' : '\n'}`)
    else process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
  }

  line(value = ''): void { if (!this.options.quiet) process.stdout.write(`${value}\n`) }
  /**
   * The phase a long command is entering, so nothing can begin without saying
   * so. Matches `step` in scripts/lib/common.sh, which the shell half of this
   * repository has used since bootstrap was a shell script.
   *
   * Never under `--json`: a step is narration, and a machine reading stdout
   * has no use for it even on stderr.
   */
  step(value: string): void { if (!this.options.quiet && !this.options.json) process.stderr.write(`\n:: ${value}\n`) }
  progress(value: string): void { if (!this.options.quiet) process.stderr.write(`${value}\n`) }
  detail(value: string): void { if (this.options.verbose) process.stderr.write(`${value}\n`) }
  warning(value: string): void { process.stderr.write(`warning: ${value}\n`) }
  error(value: string): void { process.stderr.write(`error: ${value}\n`) }
  hint(value: string): void { process.stderr.write(`  -> ${value}\n`) }
  get json(): boolean { return this.options.json === true }
}
