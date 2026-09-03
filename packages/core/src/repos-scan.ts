// What the host collects about a repository, and how it is keyed.
//
// The scan runs on the host (CLI / collector) and writes one file per
// repository under state/git, plus an index that maps environments to the
// repository they run from. The panel only reads the result. This module is
// the shape of that result and the pure helpers both sides share; the process
// execution stays in the CLI. See docs/adr/0032-portta-development-model.md,
// which amends ADR 0010: recent commits (metadata) and the content of the
// instruction files an agent reads are collected; a diff, an arbitrary file or
// a .env never is.

import { createHash } from 'node:crypto'
import { posix } from 'node:path'

export const SCAN_VERSION = 1
export const SCAN_INDEX_FILE = 'index.json'
export const RECENT_COMMITS = 20
export const INSTRUCTION_MAX_BYTES = 64 * 1024
export const REPOS_SCAN_INTERVAL_MS = 60_000

/**
 * Files an agent reads before it works. Exact paths, relative to the git root,
 * plus one bounded directory pattern. Nothing else is ever read: this is an
 * allowlist, not a search.
 */
export const INSTRUCTION_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  'CONVENTIONS.md',
  '.clinerules',
  '.cursorrules',
  '.windsurfrules',
  '.github/copilot-instructions.md',
] as const

export const INSTRUCTION_DIRECTORIES = [{ directory: '.cursor/rules', extension: '.mdc' }] as const

/** Names that are never instruction files, whatever their location. */
const FORBIDDEN_NAMES = new Set(['.env', '.env.local', '.env.production', 'id_rsa', 'id_ed25519'])

export function isInstructionPath(relativePath: string): boolean {
  const normalized = posix.normalize(relativePath).replace(/^\.\//, '')
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) return false
  if (FORBIDDEN_NAMES.has(posix.basename(normalized))) return false
  if ((INSTRUCTION_FILES as readonly string[]).includes(normalized)) return true
  return INSTRUCTION_DIRECTORIES.some(({ directory, extension }) => {
    const prefix = `${directory}/`
    return normalized.startsWith(prefix) &&
      !normalized.slice(prefix.length).includes('/') &&
      normalized.endsWith(extension)
  })
}

/** Which agent or convention a file speaks to; a hint for the UI, not a rule. */
export function instructionAudience(relativePath: string): string {
  const name = posix.basename(relativePath)
  if (name === 'AGENTS.md' || name === 'CONVENTIONS.md') return 'any'
  if (name === 'CLAUDE.md') return 'claude'
  if (name === 'GEMINI.md') return 'gemini'
  if (name === '.clinerules') return 'cline'
  if (name === '.windsurfrules') return 'windsurf'
  if (name === '.cursorrules' || relativePath.startsWith('.cursor/')) return 'cursor'
  if (relativePath.startsWith('.github/')) return 'copilot'
  return 'any'
}

/**
 * A stable, filename-safe key for a repository: twelve hex characters of the
 * realpath's SHA-1. Stable across scans and across renames of the Compose
 * project, which is the point of keying by repository rather than environment.
 */
export function repositoryKey(realpath: string): string {
  return createHash('sha1').update(normalizeRoot(realpath)).digest('hex').slice(0, 12)
}

/** What the panel accepts as a key: exactly what `repositoryKey` produces. */
export const REPOSITORY_KEY = /^[0-9a-f]{12}$/

function normalizeRoot(realpath: string): string {
  const normalized = posix.normalize(realpath).replace(/\/+$/, '')
  return normalized === '' ? '/' : normalized
}

export interface CommitSummary {
  sha: string
  shortSha: string
  subject: string
  author: string
  email: string
  /** Unix seconds */
  date: number
}

/** `git log --format` producing one record per line, unit-separated. */
export const GIT_LOG_FORMAT = '%H%x1f%h%x1f%s%x1f%an%x1f%ae%x1f%ct'

export function parseGitLog(raw: string, limit = RECENT_COMMITS): CommitSummary[] {
  const commits: CommitSummary[] = []
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    const [sha = '', shortSha = '', subject = '', author = '', email = '', date = '0'] = line.split('\x1f')
    if (!/^[0-9a-f]{7,40}$/.test(sha)) continue
    commits.push({ sha, shortSha: shortSha || sha.slice(0, 7), subject, author, email, date: Number(date) || 0 })
    if (commits.length >= limit) break
  }
  return commits
}

export interface InstructionFile {
  /** Relative to the git root */
  path: string
  audience: string
  sizeBytes: number
  /** Unix seconds */
  modifiedAt: number
  sha256: string
  /** True when the working tree differs from HEAD for this file */
  dirty: boolean
  /** Present when the file fits INSTRUCTION_MAX_BYTES; otherwise null and `truncated` says so */
  content: string | null
  truncated: boolean
}

export interface RepositoryGitSnapshot {
  branch: string | null
  detached: boolean
  head: { sha: string; shortSha: string; subject: string; author: string; date: number }
  staged: number
  unstaged: number
  untracked: number
  unmerged: number
  dirty: boolean
  upstream: string | null
  ahead: number
  behind: number
  remote: string | null
}

export interface RepositoryScan {
  version: number
  key: string
  /** realpath of the git root */
  path: string
  name: string
  collectedAt: number
  git: RepositoryGitSnapshot | null
  reason: string | null
  commits: CommitSummary[]
  instructions: InstructionFile[]
  /** COMPOSE_PROJECT_NAMEs whose working directory sits under this root */
  environments: string[]
  forge?: Record<string, unknown> | null
}

export interface ScanIndexEntry {
  key: string
  path: string
  name: string
  remote: string | null
  /** Where the root sits relative to Projects Home, when a Home is configured */
  location: 'managed' | 'external' | 'escaped' | 'missing' | 'inaccessible' | null
  /** Path relative to Projects Home, one or two segments (a workspace directory may hold repositories), null outside it */
  relativePath: string | null
}

export interface ScanIndex {
  version: number
  collectedAt: number
  home: string | null
  repositories: ScanIndexEntry[]
  /** COMPOSE_PROJECT_NAME → repository key */
  environments: Record<string, string>
}

/** The git root that owns a working directory, when one of the roots contains it. */
export function rootFor(workingDir: string, roots: readonly string[]): string | null {
  const dir = posix.normalize(workingDir)
  let best: string | null = null
  for (const root of roots) {
    const normalized = posix.normalize(root)
    if (dir === normalized || dir.startsWith(`${normalized}/`)) {
      if (best === null || normalized.length > best.length) best = normalized
    }
  }
  return best
}

/** A repository's display name: the root's basename. */
export function repositoryName(realpath: string): string {
  return posix.basename(normalizeRoot(realpath)) || realpath
}

/** The one command that refreshes a repository's snapshot on the host. */
export function refreshCommandFor(target: { environment?: string | null; path?: string | null }): string {
  if (target.environment) return `./bin/portta repos scan --environment ${target.environment}`
  if (target.path) return `./bin/portta repos scan --path ${target.path}`
  return './bin/portta repos scan'
}
