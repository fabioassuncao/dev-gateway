import { describe, expect, it } from 'vitest'
import { slug } from '../../src/shared/slug.ts'

describe('shared slug', () => {
  it('keeps the settings group routes stable', () => {
    expect(
      ['Gateway', 'Traefik', 'TLS', 'VPN', 'Public access', 'DNS', 'Panel'].map(slug),
    ).toEqual(['gateway', 'traefik', 'tls', 'vpn', 'public-access', 'dns', 'panel'])
  })
})
