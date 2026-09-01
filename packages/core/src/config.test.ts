import { describe, expect, it } from 'vitest'
import { composeFiles, loadGatewayConfig } from './config.js'

describe('gateway configuration', () => {
  it('owns the safe local defaults shared by panel and CLI', () => {
    const config = loadGatewayConfig({})
    expect(config).toMatchObject({ profile: 'local', domain: 'localhost', bindAddress: '127.0.0.1', publicEnabled: false, webEnabled: false })
    expect(composeFiles(config)).toEqual(['compose.yaml', 'compose.attach-host.yaml', 'compose.local.yaml'])
  })

  it('selects the web development overlay once', () => {
    const config = loadGatewayConfig({ DEV_GATEWAY_WEB: 'true', DEV_GATEWAY_WEB_DEV: 'true' })
    expect(composeFiles(config)).toEqual(['compose.yaml', 'compose.attach-host.yaml', 'compose.local.yaml', 'compose.web.yaml', 'compose.db.yaml', 'compose.web-dev.yaml'])
  })

  it('refuses a public profile with no public domain', () => {
    expect(() => loadGatewayConfig({ DEV_GATEWAY_PROFILE: 'remote-public' })).toThrow('PUBLIC_DOMAIN')
  })
})
