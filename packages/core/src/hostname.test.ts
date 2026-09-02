import { describe, expect, it } from 'vitest'
import {
  MAX_LABEL,
  defaultRuleTemplate,
  fitLabel,
  hostLabel,
  dashboardAdvertisedHost,
  hostnameFor,
  parseHostLabel,
  shortHash,
} from './hostname.js'

describe('the hostname label', () => {
  it('keeps producing exactly what Traefik has always produced', () => {
    // The default style must not move a single existing URL.
    expect(hostLabel({ project: 'storefront', service: 'web' })).toBe('storefront-web')
  })

  it('puts the service first when asked, separated unambiguously', () => {
    expect(hostLabel({ project: 'storefront', service: 'web' }, 'service--project')).toBe('web--storefront')
  })

  it('carries a context as a third component', () => {
    expect(hostLabel({ project: 'storefront', service: 'web', context: 'pr-42' }, 'service--project'))
      .toBe('web--storefront--pr-42')
  })

  it('normalises anything a branch name can contain', () => {
    // `feature/auth/login` is the example from the request, and the point is
    // that it can never introduce a `--` that would be read back as a boundary.
    expect(hostLabel({ project: 'shop', service: 'web', context: 'feature/auth/login' }, 'service--project'))
      .toBe('web--shop--feature-auth-login')
  })

  it('collapses runs, so no component can contain the separator', () => {
    expect(hostLabel({ project: 'a__b', service: 'c   d' }, 'service--project')).toBe('c-d--a-b')
  })

  it('gives the older style a separator too when there is a context to carry', () => {
    expect(hostLabel({ project: 'shop', service: 'web', context: 'pr-9' })).toBe('shop-web--pr-9')
  })
})

describe('length', () => {
  it('leaves a label that fits completely alone', () => {
    expect(fitLabel('short')).toBe('short')
  })

  it('keeps two over-long names apart instead of truncating them onto each other', () => {
    // Truncation alone would make these the same label, and Traefik would
    // route both to whichever container it matched first.
    const a = fitLabel(`web--${'a'.repeat(80)}--one`)
    const b = fitLabel(`web--${'a'.repeat(80)}--two`)
    expect(a).not.toBe(b)
    expect(a.length).toBeLessThanOrEqual(MAX_LABEL)
    expect(b.length).toBeLessThanOrEqual(MAX_LABEL)
  })

  it('never ends a trimmed label on a dash', () => {
    const label = fitLabel(`${'ab-'.repeat(30)}`)
    expect(label).not.toMatch(/-$/)
    expect(label.length).toBeLessThanOrEqual(MAX_LABEL)
  })

  it('is stable: the same input always gives the same label', () => {
    const input = { project: 'x'.repeat(70), service: 'web' }
    expect(hostLabel(input, 'service--project')).toBe(hostLabel(input, 'service--project'))
  })

  it('refuses a whole hostname the DNS could not carry', () => {
    expect(() => hostnameFor({ project: 'p', service: 's' }, `${'sub.'.repeat(70)}example.com`)).toThrow(/253/)
  })
})

describe('reading a label back', () => {
  it('recovers the components of the unambiguous style', () => {
    expect(parseHostLabel('web--storefront')).toEqual({ project: 'storefront', service: 'web', context: null })
    expect(parseHostLabel('api--shop--pr-42')).toEqual({ project: 'shop', service: 'api', context: 'pr-42' })
  })

  it('refuses to guess at the ambiguous style rather than guessing wrong', () => {
    expect(parseHostLabel('storefront-web', 'project-service')).toBeNull()
    expect(parseHostLabel('storefront-web')).toBeNull()
  })
})

describe('the digest', () => {
  it('is stable and distinguishes inputs', () => {
    expect(shortHash('a')).toBe(shortHash('a'))
    expect(shortHash('a')).not.toBe(shortHash('b'))
  })
})

describe('the Traefik rule', () => {
  // Traefik bakes this in at container start; if it drifts from hostLabel the
  // panel prints one name and the gateway serves another.
  it('matches the rule the gateway has always shipped', () => {
    expect(defaultRuleTemplate('localhost')).toContain(
      '{{ normalize (index .Labels "com.docker.compose.project") }}-{{ normalize (index .Labels "com.docker.compose.service") }}',
    )
    expect(defaultRuleTemplate('localhost')).toContain('.localhost`)')
  })

  it('reverses the order and the separator for the other style', () => {
    expect(defaultRuleTemplate('example.com', 'service--project')).toContain(
      '{{ normalize (index .Labels "com.docker.compose.service") }}--{{ normalize (index .Labels "com.docker.compose.project") }}',
    )
  })
})

describe('the dashboard advertised host', () => {
  it('follows the same label as every other service, never a hardcoded name', () => {
    expect(dashboardAdvertisedHost('portta', 'dev.example.com')).toBe('portta-traefik.dev.example.com')
    expect(dashboardAdvertisedHost('portta', 'dev.example.com', 'service--project')).toBe(
      'traefik--portta.dev.example.com',
    )
  })
})
