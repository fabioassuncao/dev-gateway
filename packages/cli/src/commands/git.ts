import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Command } from 'commander'
import { gatewayContext } from '../context.js'
import { inspectContainers } from '../docker.js'
import { UsageError } from '../errors.js'
import { Output } from '../output.js'
import { runProcess } from '../process.js'

function globals(command: Command) { return command.optsWithGlobals() as { json?: boolean; yes?: boolean; quiet?: boolean; verbose?: boolean; profile?: string } }

async function git(cwd: string, args: string[]): Promise<string | null> {
  const result = await runProcess('git', ['-C', cwd, ...args], { reject: false })
  return result.exitCode === 0 ? result.stdout.trim() : null
}

function workdir(labels: Record<string, string>): string | null { return labels['portta.git.root'] ?? labels['com.docker.compose.project.working_dir'] ?? null }

function counts(status: string): { staged: number; unstaged: number; untracked: number; unmerged: number } {
  let staged = 0, unstaged = 0, untracked = 0, unmerged = 0
  for (const line of status.split('\n')) {
    if (/^[12] /.test(line)) { const xy = line.split(' ')[1] ?? '..'; if (xy[0] !== '.') staged++; if (xy[1] !== '.') unstaged++ }
    else if (line.startsWith('u ')) unmerged++
    else if (line.startsWith('? ')) untracked++
  }
  return { staged, unstaged, untracked, unmerged }
}

function checkState(raw: unknown): 'failing' | 'pending' | 'passing' | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const states = raw.map((entry) => {
    const value = (entry ?? {}) as Record<string, unknown>
    return value['conclusion'] ?? value['state']
  })
  if (states.some((state) => ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED'].includes(String(state)))) return 'failing'
  if (states.some((state) => state === null || state === '' || ['PENDING', 'IN_PROGRESS', 'QUEUED'].includes(String(state)))) return 'pending'
  return 'passing'
}

function normalizePulls(raw: string): Array<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.slice(0, 10).map((entry) => {
      const value = (entry ?? {}) as Record<string, unknown>
      return {
        number: Number(value['number'] ?? 0),
        title: String(value['title'] ?? ''),
        state: String(value['state'] ?? 'OPEN'),
        draft: value['isDraft'] === true,
        reviewDecision: value['reviewDecision'] ?? null,
        url: value['url'] ?? null,
        headRefName: value['headRefName'] ?? null,
        checks: checkState(value['statusCheckRollup']),
      }
    })
  } catch {
    return []
  }
}

export async function collectGitProject(project: string, path: string, declaredRemote = '', withPrs = false, cachedForge?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const collectedAt = Math.floor(Date.now() / 1000)
  const base: Record<string, unknown> = { project, workingDir: path, collectedAt }
  if (!(await git(path, ['rev-parse', '--is-inside-work-tree']))) return { ...base, git: null, reason: existsSync(path) ? 'not a git repository' : 'directory not readable from the host' }
  const branchName = await git(path, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const detached = branchName === 'HEAD'
  const sha = await git(path, ['rev-parse', 'HEAD']) ?? ''
  const upstream = await git(path, ['rev-parse', '--abbrev-ref', '@{upstream}'])
  const aheadBehind = upstream ? await git(path, ['rev-list', '--left-right', '--count', `${upstream}...HEAD`]) : null
  const [behind = '0', ahead = '0'] = aheadBehind?.split(/\s+/) ?? []
  const changes = counts(await git(path, ['status', '--porcelain=v2', '--untracked-files=normal']) ?? '')
  const remote = declaredRemote || await git(path, ['remote', 'get-url', 'origin'])
  const value: Record<string, unknown> = {
    ...base,
    git: {
      branch: detached ? null : branchName,
      detached,
      head: { sha, shortSha: await git(path, ['rev-parse', '--short', 'HEAD']) ?? sha.slice(0, 7), subject: await git(path, ['log', '-1', '--format=%s']) ?? '', author: await git(path, ['log', '-1', '--format=%an']) ?? '', date: Number(await git(path, ['log', '-1', '--format=%ct']) ?? 0) },
      ...changes, dirty: Object.values(changes).some((count) => count > 0), upstream, ahead: Number(ahead), behind: Number(behind), remote,
    },
    reason: null,
  }
  if (withPrs && remote && /github\.com[/:]/.test(remote)) {
    if (cachedForge) {
      value['forge'] = cachedForge
      return value
    }
    const slug = remote.replace(/^.*github\.com[/:]/, '').replace(/\.git$/, '')
    const auth = await runProcess('gh', ['auth', 'status', '--hostname', 'github.com'], { reject: false })
    if (auth.exitCode !== 0) value['forge'] = { kind: 'github', collectedAt, authenticated: false, reason: 'gh is unavailable or signed out', pulls: [] }
    else {
      const prs = await runProcess('gh', ['pr', 'list', '--repo', slug, '--state', 'open', '--limit', '10', '--json', 'number,title,state,isDraft,reviewDecision,url,headRefName,statusCheckRollup'], { reject: false })
      value['forge'] = { kind: 'github', collectedAt, authenticated: true, reason: prs.exitCode === 0 ? null : 'GitHub did not answer the pull request query', pulls: prs.exitCode === 0 ? normalizePulls(prs.stdout) : [] }
    }
  }
  return value
}

export async function gitScan(options: { project?: string; withPrs?: boolean; forgeTtl?: string }, command: Command): Promise<void> {
  if (options.forgeTtl !== undefined && !/^\d+$/.test(options.forgeTtl)) throw new UsageError('--forge-ttl must be a number of seconds')
  const context = gatewayContext({ profile: globals(command).profile })
  const directory = join(context.root, 'state/git')
  mkdirSync(directory, { recursive: true })
  const projects = new Map<string, { path: string; declared: string }>()
  for (const container of await inspectContainers(false)) {
    const name = container.labels['com.docker.compose.project']
    const path = workdir(container.labels)
    if (name && path && (!options.project || options.project === name)) projects.set(name, { path, declared: container.labels['portta.repo'] ?? '' })
  }
  const scanned: unknown[] = []
  for (const [project, coordinate] of projects) {
    const target = join(directory, `${project}.json`)
    const forgeTtl = Number(options.forgeTtl ?? 300)
    let cachedForge: Record<string, unknown> | undefined
    if (options.withPrs && forgeTtl > 0 && existsSync(target)) {
      try {
        const previous = JSON.parse(readFileSync(target, 'utf8')) as Record<string, unknown>
        const forge = previous['forge'] as Record<string, unknown> | undefined
        if (forge && Math.floor(Date.now() / 1000) - Number(forge['collectedAt'] ?? 0) < forgeTtl) cachedForge = forge
      } catch { /* malformed cache is replaced by this scan */ }
    }
    const value = await collectGitProject(project, coordinate.path, coordinate.declared, options.withPrs, cachedForge)
    writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
    chmodSync(target, 0o600)
    scanned.push(value)
  }
  const output = new Output(globals(command))
  if (output.json) output.data({ projects: scanned })
  else output.progress(`scanned ${scanned.length} project(s)`)
}

export async function gitStatus(command: Command): Promise<void> {
  const context = gatewayContext({ profile: globals(command).profile })
  const directory = join(context.root, 'state/git')
  const projects: Array<Record<string, unknown> & { ageSeconds: number }> = existsSync(directory) ? readdirSync(directory).filter((file) => file.endsWith('.json')).map((file) => {
    const value = JSON.parse(readFileSync(join(directory, file), 'utf8')) as Record<string, unknown>
    return { ...value, ageSeconds: Math.max(0, Math.floor(Date.now() / 1000) - Number(value['collectedAt'] ?? 0)) }
  }) : []
  const output = new Output(globals(command))
  if (output.json) output.data({ projects })
  else for (const project of projects) output.line(`${String(project['project'] ?? basename(String(project['worktree'] ?? 'unknown')))}\t${String(project['branch'] ?? 'detached')}\t${project.ageSeconds}s old`)
}

export async function gitClear(command: Command): Promise<void> {
  const context = gatewayContext({ profile: globals(command).profile })
  const directory = join(context.root, 'state/git')
  if (!existsSync(directory)) return
  let count = 0
  for (const file of readdirSync(directory)) if (file.endsWith('.json')) { unlinkSync(join(directory, file)); count++ }
  new Output(globals(command)).progress(`removed ${count} collected Git file(s)`)
}
