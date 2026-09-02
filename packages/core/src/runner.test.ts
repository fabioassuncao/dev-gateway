import { describe, it, expect } from 'vitest'
import {
  composeFilesFromLabel,
  parseRunnerRequest,
  projectOperable,
  runnerCreateArguments,
  runnerRefusal,
  runnerSpec,
  RUNNER_IMAGE,
} from './runner.ts'

describe('parseRunnerRequest', () => {
  it('accepts every verb in the closed set', () => {
    for (const verb of ['up', 'stop', 'restart', 'build', 'down', 'down-volumes']) {
      expect(parseRunnerRequest({ verb, project: 'alpha' }).verb).toBe(verb)
    }
  })

  it('rejects anything outside the set', () => {
    expect(() => parseRunnerRequest({ verb: 'exec', project: 'alpha' })).toThrow('unknown runner verb')
    expect(() => parseRunnerRequest({ verb: 'down --volumes', project: 'alpha' })).toThrow('unknown runner verb')
    expect(() => parseRunnerRequest({ verb: 'rm -rf', project: 'alpha' })).toThrow('unknown runner verb')
  })

  it('rejects a missing or illegal project name', () => {
    expect(() => parseRunnerRequest({ verb: 'up' })).toThrow('project name')
    expect(() => parseRunnerRequest({ verb: 'up', project: '' })).toThrow('project name')
    expect(() => parseRunnerRequest({ verb: 'up', project: '../etc' })).toThrow('refusing project name')
    expect(() => parseRunnerRequest({ verb: 'up', project: 'alpha; rm -rf /' })).toThrow('refusing project name')
  })

  it('accepts no-cache only on build', () => {
    expect(parseRunnerRequest({ verb: 'build', project: 'alpha', flags: ['no-cache'] }).flags).toEqual(['no-cache'])
    expect(() => parseRunnerRequest({ verb: 'up', project: 'alpha', flags: ['no-cache'] })).toThrow('no-cache')
    expect(() => parseRunnerRequest({ verb: 'build', project: 'alpha', flags: ['privileged'] })).toThrow('unknown runner flag')
  })
})

describe('projectOperable', () => {
  it('a project with no working-dir label is not operable', () => {
    const result = projectOperable(null)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('working directory')
  })

  it('a project with a working-dir label is operable', () => {
    const result = projectOperable('/srv/dev/alpha', ['/srv/dev/alpha/compose.yaml'])
    expect(result.ok).toBe(true)
    expect(result.reason).toBeNull()
    expect(result.configFiles).toEqual(['/srv/dev/alpha/compose.yaml'])
  })
})

describe('composeFilesFromLabel', () => {
  it('splits the Compose comma-separated list', () => {
    expect(composeFilesFromLabel('/a/compose.yaml,/a/compose.portta.yaml')).toEqual([
      '/a/compose.yaml',
      '/a/compose.portta.yaml',
    ])
  })

  it('is empty when the label is missing', () => {
    expect(composeFilesFromLabel(null)).toEqual([])
    expect(composeFilesFromLabel('')).toEqual([])
  })
})

describe('runnerRefusal', () => {
  it('serves a plain local host', () => {
    expect(runnerRefusal({ PORTTA_PROFILE: 'local' })).toBeNull()
  })

  it('refuses a publicly exposed panel', () => {
    expect(runnerRefusal({ PORTTA_WEB_EXPOSE: 'public' })).toContain('on the host instead')
  })

  it('refuses the remote-public profile', () => {
    expect(runnerRefusal({ PORTTA_PROFILE: 'remote-public' })).toContain('on the host only')
  })
})

describe('the container it would create', () => {
  const args = runnerCreateArguments('/opt/portta', runnerSpec('/opt/portta', '0.7.2'))

  it('takes no network, so it cannot be a pivot', () => {
    expect(args).toContain('--network')
    expect(args[args.indexOf('--network') + 1]).toBe('none')
  })

  it('fixes its command at creation', () => {
    expect(args.slice(-2)).toEqual(['bash', '/opt/portta/scripts/lib/runner-exec.sh'])
  })

  it('mounts the host filesystem at /host, and the root at its host path', () => {
    expect(args).toContain('/:/host')
    expect(args).toContain('/opt/portta:/opt/portta')
  })

  it('records the image in its spec', () => {
    expect(runnerSpec('/opt/portta', '0.7.2')).toContain(RUNNER_IMAGE)
  })
})
