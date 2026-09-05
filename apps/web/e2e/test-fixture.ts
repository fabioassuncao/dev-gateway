import { test as base, expect } from '@playwright/test'
import { startPanel } from './resources.mjs'

type Panel = Awaited<ReturnType<typeof startPanel>>
const OWNER = { name: 'Ada Lovelace', email: 'ada@example.test', password: 'an-end-to-end-password' }

export const test = base.extend<{ engineURL: string; ownerReady: void }, { panel: Panel }>({
  panel: [async ({}, use, info) => {
    const protectedPanel = ['auth', 'roles', 'settings'].includes(info.project.name)
    const panel = await startPanel({ mode: protectedPanel ? 'required' : 'disabled' })
    try { await use(panel) } finally { await panel.close() }
  }, { scope: 'worker', timeout: 90_000 }],
  baseURL: async ({ panel }, use) => { await use(panel.url) },
  engineURL: async ({ panel }, use) => { await use(panel.engineURL) },
  ownerReady: [async ({ playwright, panel }, use, info) => {
    // Bootstrap itself is exercised through the UI. Every other protected
    // scenario can run alone, including a name-filtered wrong-password test.
    if (['roles', 'settings'].includes(info.project.name) || (info.project.name === 'auth' && info.title === 'says nothing useful about a password that is wrong')) {
      const request = await playwright.request.newContext({ baseURL: panel.url })
      try {
        const response = await request.get('/api/auth/status')
        expect(response.ok()).toBe(true)
        if ((await response.json()).setupRequired) {
          const setup = await request.post('/api/auth/setup', { data: OWNER })
          expect(setup.status()).toBe(201)
        }
      } finally { await request.dispose() }
    }
    await use()
  }, { auto: true }],
})
export { expect }
