import { describe, expect, it } from 'vitest'
import { renderAuthDynamic } from './dynamic.ts'
import { emptyProtectionStore, setProtection } from './protections.ts'

describe('ForwardAuth dynamic file', () => {
  it('renders a shared middleware and one unprotected reserved-path router per protection', () => {
    const store = setProtection(emptyProtectionStore(), {
      scope: 'share:a7f3', host: 'demo.example.com', entryPoints: ['websecure'],
      user: 'reviewer', hash: '$apr1$a$b', label: 'Demo',
    })
    const yaml = renderAuthDynamic(store)
    expect(yaml).toContain('portta-forward-auth:')
    expect(yaml).toContain('address: "http://portta-auth:4180/verify"')
    expect(yaml).toContain('Host(`demo.example.com`) && PathPrefix(`/__portta/auth`)')
    expect(yaml).toContain('priority: 10000')
    const router = yaml.slice(yaml.indexOf('portta-auth-login-share-a7f3:'), yaml.indexOf('  services:'))
    expect(router).not.toContain('middlewares:')
  })

  it('keeps the panel scope explicit without putting credentials in YAML', () => {
    const yaml = renderAuthDynamic(emptyProtectionStore())
    expect(yaml).toContain('/verify?scope=panel')
    expect(yaml).not.toContain('basicAuth')
    expect(yaml).not.toContain('users:')
  })
})
