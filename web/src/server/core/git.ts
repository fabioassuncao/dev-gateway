// Reading what `dev-gateway git scan` collected on the host.
//
// The panel has no access to any project directory and runs no shell commands.
// It reads one file per project from a read-only mount, and reports how old it
// is: what is on screen is as true as the last scan, and the UI says so rather
// than implying currency. See docs/adr/0010-git-collected-on-the-host.md.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { PanelConfig } from '../config.ts'
import { branchUrl, commitUrl, parseRemote } from './forge.ts'
import type { ForgePullRequest, GitInfo, ProjectGit } from '../../shared/types.ts'

/** Compose project names Docker itself allows, and nothing that walks a path. */
const PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * The collector writes this file, but it lands on a mount, so it is read as
 * untrusted input: every field is coerced, and a shape that does not fit is a
 * project with no Git rather than a 500.
 */
function toGitInfo(raw: unknown): GitInfo | null {
  if (raw === null || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const head = (value.head ?? {}) as Record<string, unknown>

  return {
    branch: asOptionalString(value.branch),
    detached: value.detached === true,
    head: {
      sha: asString(head.sha),
      shortSha: asString(head.shortSha),
      subject: asString(head.subject),
      author: asString(head.author),
      date: asNumber(head.date),
    },
    staged: asNumber(value.staged),
    unstaged: asNumber(value.unstaged),
    untracked: asNumber(value.untracked),
    unmerged: asNumber(value.unmerged),
    dirty: value.dirty === true,
    upstream: asOptionalString(value.upstream),
    ahead: asNumber(value.ahead),
    behind: asNumber(value.behind),
    remote: asOptionalString(value.remote),
  }
}

function toPullRequests(raw: unknown): ForgePullRequest[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 20).map((entry) => {
    const value = (entry ?? {}) as Record<string, unknown>
    return {
      number: asNumber(value.number),
      title: asString(value.title),
      state: asString(value.state) || 'OPEN',
      draft: value.draft === true,
      reviewDecision: asOptionalString(value.reviewDecision),
      checks: asOptionalString(value.checks),
      url: asOptionalString(value.url),
      headRefName: asOptionalString(value.headRefName),
    }
  })
}

export function gitFileFor(config: PanelConfig, project: string): string | null {
  if (!PROJECT_NAME.test(project)) return null
  return join(config.gitDir, `${project}.json`)
}

/**
 * What the panel knows about one project's repository, or the honest absence
 * of it. Never throws: an unreadable or malformed file is reported as not
 * collected, with the command that would fix it.
 */
export function readProjectGit(config: PanelConfig, project: string, now = Date.now()): ProjectGit {
  const refreshCommand = `./bin/dev-gateway git scan --project ${project}`
  const absent: ProjectGit = {
    project,
    collected: false,
    collectedAt: null,
    ageSeconds: null,
    stale: false,
    staleAfterSeconds: config.gitStaleSeconds,
    workingDir: null,
    git: null,
    remote: null,
    links: { repo: null, commit: null, branch: null },
    forge: null,
    reason: null,
    refreshCommand,
  }

  const file = gitFileFor(config, project)
  if (file === null || !existsSync(file)) return absent

  let parsed: Record<string, unknown>
  try {
    // Bounded: this is a metadata file, and anything large is not one.
    if (statSync(file).size > 512 * 1024) {
      return { ...absent, reason: 'the collected file is implausibly large and was not read' }
    }
    parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  } catch {
    return { ...absent, reason: 'the collected file could not be read' }
  }

  const collectedAt = asNumber(parsed.collectedAt)
  const ageSeconds = collectedAt > 0 ? Math.max(0, Math.floor(now / 1000) - collectedAt) : null
  const git = toGitInfo(parsed.git)
  const remote = git?.remote ? parseRemote(git.remote) : null
  const forgeRaw = (parsed.forge ?? null) as Record<string, unknown> | null

  return {
    project,
    collected: true,
    collectedAt: collectedAt > 0 ? collectedAt : null,
    ageSeconds,
    stale: ageSeconds !== null && ageSeconds > config.gitStaleSeconds,
    staleAfterSeconds: config.gitStaleSeconds,
    workingDir: asOptionalString(parsed.workingDir),
    git,
    remote: remote
      ? { url: remote.url, host: remote.host, slug: remote.slug, kind: remote.kind, repoUrl: remote.repoUrl }
      : null,
    links: {
      repo: remote?.repoUrl ?? null,
      commit: remote && git ? commitUrl(remote, git.head.sha) : null,
      branch: remote && git?.branch ? branchUrl(remote, git.branch) : null,
    },
    forge: forgeRaw
      ? {
          kind: asString(forgeRaw.kind) || 'github',
          collectedAt: asNumber(forgeRaw.collectedAt) || collectedAt,
          authenticated: forgeRaw.authenticated !== false,
          reason: asOptionalString(forgeRaw.reason),
          pulls: toPullRequests(forgeRaw.pulls),
        }
      : null,
    reason: asOptionalString(parsed.reason),
    refreshCommand,
  }
}
