import { describe, expect, it } from 'vitest'
import {
  GIT_LOG_FORMAT,
  INSTRUCTION_MAX_BYTES,
  REPOSITORY_KEY,
  instructionAudience,
  isInstructionPath,
  parseGitLog,
  refreshCommandFor,
  repositoryKey,
  repositoryName,
  rootFor,
} from './repos-scan.js'

describe('instruction allowlist', () => {
  it('accepts the documented files and nothing else', () => {
    expect(isInstructionPath('AGENTS.md')).toBe(true)
    expect(isInstructionPath('./CLAUDE.md')).toBe(true)
    expect(isInstructionPath('.github/copilot-instructions.md')).toBe(true)
    expect(isInstructionPath('.cursor/rules/style.mdc')).toBe(true)
    expect(isInstructionPath('.cursor/rules/nested/style.mdc')).toBe(false)
    expect(isInstructionPath('.cursor/rules/style.md')).toBe(false)
    expect(isInstructionPath('README.md')).toBe(false)
    expect(isInstructionPath('.env')).toBe(false)
    expect(isInstructionPath('../AGENTS.md')).toBe(false)
    expect(isInstructionPath('/etc/passwd')).toBe(false)
    expect(isInstructionPath('docs/AGENTS.md')).toBe(false)
  })
  it('names the audience', () => {
    expect(instructionAudience('CLAUDE.md')).toBe('claude')
    expect(instructionAudience('.cursor/rules/a.mdc')).toBe('cursor')
    expect(instructionAudience('AGENTS.md')).toBe('any')
  })
  it('bounds the content', () => expect(INSTRUCTION_MAX_BYTES).toBe(65536))
})

describe('repository key', () => {
  it('is twelve hex characters, stable, and independent of a trailing slash', () => {
    const key = repositoryKey('/srv/projects/shop/')
    expect(key).toMatch(REPOSITORY_KEY)
    expect(repositoryKey('/srv/projects/shop')).toBe(key)
    expect(repositoryKey('/srv/projects/other')).not.toBe(key)
  })
  it('names a repository after its root', () => expect(repositoryName('/srv/projects/shop/')).toBe('shop'))
})

describe('git log', () => {
  it('parses the unit-separated format and caps the list', () => {
    const line = (n: number) => `${'a'.repeat(39)}${n}\x1fabc${n}\x1fSubject ${n}\x1fAda\x1fada@example.com\x1f170000000${n}`
    const raw = [line(1), line(2), 'garbage', line(3)].join('\n')
    const commits = parseGitLog(raw, 2)
    expect(commits).toHaveLength(2)
    expect(commits[0]).toEqual({ sha: `${'a'.repeat(39)}1`, shortSha: 'abc1', subject: 'Subject 1', author: 'Ada', email: 'ada@example.com', date: 1700000001 })
    expect(GIT_LOG_FORMAT).toContain('%x1f')
  })
})

describe('roots', () => {
  it('picks the deepest root that contains a working directory', () => {
    const roots = ['/srv/projects/shop', '/srv/projects/shop/packages/api', '/srv/projects/other']
    expect(rootFor('/srv/projects/shop/packages/api/compose', roots)).toBe('/srv/projects/shop/packages/api')
    expect(rootFor('/srv/projects/shop', roots)).toBe('/srv/projects/shop')
    expect(rootFor('/srv/projects/shopping', roots)).toBeNull()
  })
})

describe('refresh command', () => {
  it('names the environment, the path, or nothing', () => {
    expect(refreshCommandFor({ environment: 'alpha' })).toBe('./bin/portta repos scan --environment alpha')
    expect(refreshCommandFor({ path: '/srv/p/x' })).toBe('./bin/portta repos scan --path /srv/p/x')
    expect(refreshCommandFor({})).toBe('./bin/portta repos scan')
  })
})
