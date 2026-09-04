import { describe, expect, it } from 'vitest'
import { makeApp } from './helpers.ts'

describe('the documentation routes', () => {
  it('redirects /docs to the site root, so a hash route has somewhere to hang', async () => {
    const { app } = makeApp({ containers: [] })
    const response = await app.request('/docs')
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/docs/')
  })

  // The guides are static text with no host information in them, so a routed
  // panel may serve them — unlike the API console, which issues real requests.
  it('serves the guides even when the panel is routed', async () => {
    const { app } = makeApp({ containers: [] }, { webExpose: 'vpn' })
    expect((await app.request('/docs')).status).toBe(302)
  })

  it('404s both the redirect and a deep link when the docs are disabled', async () => {
    const { app } = makeApp({ containers: [] }, { docs: false })
    expect((await app.request('/docs')).status).toBe(404)
    expect((await app.request('/docs/install')).status).toBe(404)
  })

  // The two switches are independent: turning off the console must not take
  // the guides with it, and vice versa.
  it('keeps the guides when the API console is off', async () => {
    const { app } = makeApp({ containers: [] }, { apiDocs: false, docs: true })
    expect((await app.request('/docs')).status).toBe(302)
    expect((await app.request('/api/docs')).status).toBe(404)
  })

  it('keeps the console when the guides are off', async () => {
    const { app } = makeApp({ containers: [] }, { apiDocs: true, docs: false })
    expect((await app.request('/docs')).status).toBe(404)
    expect((await app.request('/api/docs')).status).toBe(302)
  })
})
