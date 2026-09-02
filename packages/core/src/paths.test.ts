import { describe, it, expect } from 'vitest'
import { assertRemovableWorkingDir, hostPathForWorkingDir, PathRefused } from './paths.ts'

describe('assertRemovableWorkingDir', () => {
  it('accepts a normal project checkout', () => {
    expect(assertRemovableWorkingDir('/srv/dev/alpha')).toBe('/srv/dev/alpha')
    expect(assertRemovableWorkingDir('/home/dev/projects/storefront')).toBe('/home/dev/projects/storefront')
  })

  it('rejects a relative path', () => {
    expect(() => assertRemovableWorkingDir('srv/dev/alpha')).toThrow(PathRefused)
    expect(() => assertRemovableWorkingDir('alpha')).toThrow(PathRefused)
  })

  it('rejects traversal', () => {
    expect(() => assertRemovableWorkingDir('/srv/dev/../etc')).toThrow(PathRefused)
    expect(() => assertRemovableWorkingDir('/srv/dev/alpha/../../etc')).toThrow(PathRefused)
    expect(() => assertRemovableWorkingDir('/srv/dev/foo/..')).toThrow(PathRefused)
  })

  it('rejects the filesystem root and a top-level directory', () => {
    expect(() => assertRemovableWorkingDir('/')).toThrow(PathRefused)
    expect(() => assertRemovableWorkingDir('/home')).toThrow(PathRefused)
    expect(() => assertRemovableWorkingDir('/srv')).toThrow(PathRefused)
  })

  it('rejects an empty or NUL path', () => {
    expect(() => assertRemovableWorkingDir('')).toThrow(PathRefused)
    expect(() => assertRemovableWorkingDir('/srv/dev/alpha\0/etc')).toThrow(PathRefused)
  })
})

describe('hostPathForWorkingDir', () => {
  it('prefixes the runner mount', () => {
    expect(hostPathForWorkingDir('/srv/dev/alpha')).toBe('/host/srv/dev/alpha')
  })

  it('still refuses traversal before prefixing', () => {
    expect(() => hostPathForWorkingDir('/srv/../etc')).toThrow(PathRefused)
  })
})
