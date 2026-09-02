import { describe, expect, it } from 'vitest'
import { emptyProtectionStore, renderAuthDynamic, setProtection } from 'portta-core'

describe('project protection rendering', () => {
  it('keeps credentials out of the Traefik file', () => {
    const store = setProtection(emptyProtectionStore(), {
      scope: 'host:demo.example.com', host: 'demo.example.com', entryPoints: ['websecure'],
      user: 'reviewer', hash: '$portta$scrypt$65536$8$1$salt$hash', label: 'Demo',
    })
    const yaml = renderAuthDynamic(store)
    expect(yaml).toContain('Host(`demo.example.com`) && PathPrefix(`/__portta/auth`)')
    expect(yaml).not.toContain('$portta$scrypt$')
  })
})
