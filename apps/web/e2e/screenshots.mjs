#!/usr/bin/env node
// Regenerates the panel screenshots used by README.md and docs/web-ui.md.
//
//   npm run screenshots
//
// It boots the real panel against the documentation host in demo-host.mjs, so
// the images are reproducible, always show the same thing, and never contain
// whatever happens to be running on the machine that generated them.
//
// The panel's main column scrolls rather than the page, so each shot picks its
// own viewport height instead of using fullPage.

import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const outDir = join(root, '..', '..', 'docs', 'images')

const DOCKER_PORT = 9931
const PANEL_PORT = 9932
const BASE = `http://127.0.0.1:${PANEL_PORT}`

const WIDTH = 1440

const SHOTS = [
  { name: 'panel-overview', route: '/#/overview', height: 820 },
  { name: 'panel-projects', route: '/#/projects', height: 1000 },
  { name: 'panel-environments', route: '/#/environments', height: 1000 },
  { name: 'panel-environment', route: '/#/environments/storefront', height: 900 },
  { name: 'panel-services', route: '/#/services', height: 700 },
  { name: 'panel-docker', route: '/#/docker', height: 940 },
  // The sections below the fold are the point of the page: what the gateway
  // does not manage, and which container is holding the port you need.
  { name: 'panel-docker-external', route: '/#/docker', height: 940, scrollTo: 1500 },
  { name: 'panel-access', route: '/#/access', height: 980 },
  { name: 'panel-network', route: '/#/network', height: 920 },
  {
    name: 'panel-gateway',
    route: '/#/gateway',
    height: 900,
    async before(page) {
      await page.getByRole('button', { name: 'Run diagnostics' }).click()
      await page.getByText('Traefik', { exact: true }).first().waitFor()
    },
  },
  { name: 'panel-settings', route: '/#/settings/gateway', height: 880 },
  { name: 'panel-overview-dark', route: '/#/overview', height: 820, theme: 'dark' },
]

async function waitForPanel() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/api/health`)
      if (response.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('the panel did not come up')
}

mkdirSync(outDir, { recursive: true })

const harness = spawn(process.execPath, [join(here, 'harness.mjs')], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    PORTTA_E2E_FIXTURE: './demo-host.mjs',
    // The documentation host has hostname routing switched on, so the Access
    // page shows both what it offers and where it cannot.
    PORTTA_TCP: 'true',
    PORTTA_E2E_DOCKER_PORT: String(DOCKER_PORT),
    PORTTA_E2E_PANEL_PORT: String(PANEL_PORT),
  },
})

try {
  await waitForPanel()

  const browser = await chromium.launch()
  for (const shot of SHOTS) {
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: shot.height },
      deviceScaleFactor: 2,
      colorScheme: shot.theme === 'dark' ? 'dark' : 'light',
      reducedMotion: 'reduce',
    })
    const page = await context.newPage()
    await page.goto(BASE + shot.route)
    await page.waitForLoadState('networkidle')
    // The live indicator settles a beat after the first render.
    await page.waitForTimeout(900)
    if (shot.before) await shot.before(page)
    if (shot.scrollTo) {
      // The main column scrolls, not the window.
      await page.evaluate((top) => document.querySelector('main')?.scrollTo({ top }), shot.scrollTo)
      await page.waitForTimeout(400)
    }
    await page.waitForTimeout(300)

    const file = join(outDir, `${shot.name}.png`)
    await page.screenshot({ path: file })
    process.stdout.write(`wrote ${file}\n`)
    await context.close()
  }
  await browser.close()
} finally {
  harness.kill('SIGTERM')
}
