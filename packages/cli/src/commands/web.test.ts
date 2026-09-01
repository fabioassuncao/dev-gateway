import { describe, expect, it } from 'vitest'
import { renderPanelAuth } from './web.js'

describe('panel authentication rendering', () => {
  it('stores a hash behind the named middleware', () => {
    const rendered = renderPanelAuth('dev', '$apr1$abcdefgh$hash')
    expect(rendered).toContain('dev-gateway-web-auth:')
    expect(rendered).toContain('dev:$apr1$abcdefgh$hash')
    expect(rendered).not.toContain('password:')
  })
  it('fails closed by declaring no middleware when unset', () => expect(renderPanelAuth()).not.toMatch(/^http:/m))
})
