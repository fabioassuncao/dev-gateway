import { describe, expect, it } from 'vitest'
import { renderPanelAuth, webUrl } from './web.js'

describe('panel authentication rendering', () => {
  it('keeps the legacy panel file free of credentials', () => {
    const rendered = renderPanelAuth('dev', '$apr1$abcdefgh$hash')
    expect(rendered).not.toContain('portta-web-auth:')
    expect(rendered).not.toContain('$apr1$')
    expect(rendered).toContain('portta-auth.yaml')
  })
  it('fails closed by declaring no middleware when unset', () => expect(renderPanelAuth()).not.toMatch(/^http:/m))
})

type Context = Parameters<typeof webUrl>[0]

function context(config: Partial<Context['config']>, env: Record<string, string> = {}): Context {
  return {
    root: '/srv/portta',
    env,
    composeFiles: [],
    version: '0.2.0',
    config: {
      webExpose: 'local',
      webPort: 8081,
      webDev: false,
      tlsEnabled: false,
      domain: 'localhost',
      ...config,
    },
  } as unknown as Context
}

describe('where the panel answers', () => {
  it('is the server port in production', () => {
    expect(webUrl(context({}))).toBe('http://127.0.0.1:8081')
  })

  // In development Vite owns the port and proxies /api to the server beside
  // it; the server's own port serves no UI, because the dev image builds none.
  it('is Vite’s port in development, never the server’s', () => {
    expect(webUrl(context({ webDev: true }))).toBe('http://127.0.0.1:5173')
  })

  it('honours a configured development port', () => {
    expect(webUrl(context({ webDev: true }, { PORTTA_WEB_DEV_PORT: '4000' }))).toBe(
      'http://127.0.0.1:4000',
    )
  })

  it('honours the bind address in both modes', () => {
    const env = { PORTTA_WEB_BIND_ADDRESS: '100.64.0.2' }
    expect(webUrl(context({}, env))).toBe('http://100.64.0.2:8081')
    expect(webUrl(context({ webDev: true }, env))).toBe('http://100.64.0.2:5173')
  })

  it('is the routed hostname when the panel is exposed over the VPN', () => {
    expect(webUrl(context({ webExpose: 'vpn', tlsEnabled: true }))).toBe(
      'https://portta-web.localhost',
    )
  })
})
