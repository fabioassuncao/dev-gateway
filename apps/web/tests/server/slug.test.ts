import { describe, expect, it } from 'vitest'
import { slug as core } from 'portta-core'
import { ServiceKind, TcpRouting } from '../../src/shared/types.ts'
import { SERVICE_KINDS, TCP_ROUTINGS } from 'portta-core'
import { slug } from '../../src/shared/slug.ts'

describe('shared slug', () => {
  it('keeps the settings group routes stable', () => {
    expect(
      ['Gateway', 'Traefik', 'TLS', 'VPN', 'Public access', 'DNS', 'Panel'].map(slug),
    ).toEqual(['gateway', 'traefik', 'tls', 'vpn', 'public-access', 'dns', 'panel'])
  })

  // The server imports `slug` from portta-core. This copy exists for the
  // browser bundle alone: `portta-core` re-exports the password module, and the
  // UI dev container has neither the shared package's source nor its build, so
  // importing it from the UI breaks `npm run dev:ui`.
  //
  // A comment saying "keep these in sync" is what this file replaces. A
  // hostname the panel prints has to be the one Traefik serves, so the two
  // agreeing is a property, not a convention.
  it('answers exactly what portta-core answers', () => {
    const corpus = [
      '', 'a', 'Storefront', 'My Shop', 'main_db', '--leading', 'trailing--',
      'a--b', 'Ünïcødé', '123', 'feature/PORTTA-42', 'UPPER.case.dots',
      'lots   of   spaces', '!!!', 'a1-b2_c3', 'issue #7', 'v1.2.3',
    ]
    for (const value of corpus) expect(slug(value)).toBe(core(value))
  })
})

// The wire schema and the shared table describe the same thing: one is zod for
// the API, the other is the plain union the CLI compiles against. They cannot
// be one declaration without pulling zod into portta-core or portta-core into
// the browser bundle, so they are held together here instead of by a comment.
describe('the API schema and the shared table describe the same service kinds', () => {
  it('lists the same kinds, in the same order', () => {
    expect(ServiceKind.options).toEqual([...SERVICE_KINDS])
  })

  it('lists the same TCP routing verdicts', () => {
    expect(TcpRouting.options).toEqual([...TCP_ROUTINGS])
  })
})
