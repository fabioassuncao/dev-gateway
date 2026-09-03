#!/usr/bin/env node
// Regenerates the panel screenshots used by README.md and docs/web-ui.md.
//
//   npm run screenshots
//
// It boots the real panel against the documentation host in demo-host.mjs and
// a disposable PostgreSQL that receives docker/examples, so the images are
// reproducible, always show the same thing, and never contain whatever happens
// to be running on the machine that generated them.
//
// Every shot uses the same viewport. The main column scrolls; long pages set
// scrollTo rather than growing the frame.

import { execFileSync } from 'node:child_process'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const repo = join(root, '..', '..')
const outDir = join(repo, 'docs', 'images')
const examplesDir = join(repo, 'docker', 'examples')

const DOCKER_PORT = 9931
const PANEL_PORT = 9932
const PG_PORT = 55433
const PG_NAME = 'portta-screenshots-pg'
const DATABASE_URL = `postgres://postgres:screenshots@127.0.0.1:${PG_PORT}/portta`
const BASE = `http://127.0.0.1:${PANEL_PORT}`

const VIEWPORT = { width: 1440, height: 900 }

const SHOTS = [
  { name: 'panel-overview', route: '/#/overview', ready: 'Demo Shop' },
  { name: 'panel-projects', route: '/#/projects', ready: 'Demo Shop' },
  {
    name: 'panel-projects-table',
    route: '/#/projects',
    ready: 'Demo Shop',
    async before(page) {
      await page.getByRole('radio', { name: 'Table' }).click()
      await page.getByRole('table').waitFor()
    },
  },
  { name: 'panel-tasks', route: '/#/projects/demo-shop/tasks', ready: 'Configurar autenticação' },
  {
    name: 'panel-tasks-table',
    route: '/#/projects/demo-shop/tasks?view=table',
    ready: 'Configurar autenticação',
  },
  {
    name: 'panel-task',
    route: '/#/projects/demo-shop/tasks',
    ready: 'Configurar autenticação',
    async before(page) {
      // The board's ids are minted by the seed, so the shot follows a card
      // rather than guessing a number.
      await page.getByRole('link', { name: 'Configurar autenticação' }).first().click()
      await page.getByRole('heading', { level: 1 }).or(page.getByText('Configurar autenticação')).first().waitFor()
      await page.waitForTimeout(600)
    },
  },
  { name: 'panel-environments', route: '/#/environments', ready: 'demo-shop' },
  { name: 'panel-environment', route: '/#/environments/demo-shop', ready: 'Open / Test' },
  { name: 'panel-services', route: '/#/services', ready: 'demo-shop' },
  { name: 'panel-docker', route: '/#/docker' },
  { name: 'panel-docker-external', route: '/#/docker', scrollTo: 1500 },
  { name: 'panel-access', route: '/#/access', ready: '55431' },
  { name: 'panel-network', route: '/#/network' },
  {
    name: 'panel-gateway',
    route: '/#/gateway',
    async before(page) {
      await page.getByRole('button', { name: 'Run diagnostics' }).click()
      await page.getByText('Traefik', { exact: true }).first().waitFor()
    },
  },
  { name: 'panel-settings', route: '/#/settings/gateway' },
  { name: 'panel-overview-dark', route: '/#/overview', theme: 'dark', ready: 'Demo Shop' },
]

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function startPostgres() {
  try { execFileSync('docker', ['rm', '-f', PG_NAME], { stdio: 'ignore' }) } catch { /* absent */ }
  execFileSync('docker', [
    'run', '-d', '--rm', '--name', PG_NAME,
    '-e', 'POSTGRES_PASSWORD=screenshots',
    '-e', 'POSTGRES_DB=portta',
    '-p', `${PG_PORT}:5432`,
    'postgres:18.6-alpine',
  ], { stdio: 'inherit' })
}

function stopPostgres() {
  try { execFileSync('docker', ['rm', '-f', PG_NAME], { stdio: 'ignore' }) } catch { /* already gone */ }
}

async function waitForPostgres() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      execFileSync('docker', ['exec', PG_NAME, 'pg_isready', '-U', 'postgres'], { stdio: 'ignore' })
      return
    } catch {
      await sleep(500)
    }
  }
  throw new Error('screenshot postgres did not become ready')
}

async function waitForPanel() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/api/health`)
      if (response.ok) return
    } catch {
      /* not up yet */
    }
    await sleep(500)
  }
  throw new Error('the panel did not come up')
}

async function waitForDatabase() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/api/projects`)
      if (response.ok) return
    } catch {
      /* not ready */
    }
    await sleep(500)
  }
  throw new Error('the panel database did not become ready')
}

async function seedExamples() {
  const directories = readdirSync(examplesDir, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  for (const directory of directories) {
    const path = join(examplesDir, directory.name, 'portta.example.json')
    if (!existsSync(path)) continue
    const document = JSON.parse(readFileSync(path, 'utf8'))
    const slug = document.project.slug
    const existing = await fetch(`${BASE}/api/projects/${encodeURIComponent(slug)}`)
    if (existing.status === 404) {
      const created = await fetch(`${BASE}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug,
          name: document.project.name,
          description: document.project.description ?? null,
        }),
      })
      if (!created.ok) throw new Error(`create ${slug}: ${created.status} ${await created.text()}`)
    } else if (!existing.ok) {
      throw new Error(`get ${slug}: ${existing.status} ${await existing.text()}`)
    }
    const imported = await fetch(`${BASE}/api/projects/${encodeURIComponent(slug)}/tasks/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(document),
    })
    if (!imported.ok) throw new Error(`import ${slug}: ${imported.status} ${await imported.text()}`)
    process.stdout.write(`seeded ${slug}\n`)
  }
}

mkdirSync(outDir, { recursive: true })
startPostgres()
await waitForPostgres()

const harness = spawn(process.execPath, [join(here, 'harness.mjs')], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    PORTTA_E2E_FIXTURE: './demo-host.mjs',
    PORTTA_TCP: 'true',
    PORTTA_E2E_DOCKER_PORT: String(DOCKER_PORT),
    PORTTA_E2E_PANEL_PORT: String(PANEL_PORT),
    PORTTA_RUNTIME_DATABASE_URL: DATABASE_URL,
  },
})

try {
  await waitForPanel()
  await waitForDatabase()
  await seedExamples()

  const browser = await chromium.launch()
  for (const shot of SHOTS) {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
      colorScheme: shot.theme === 'dark' ? 'dark' : 'light',
      reducedMotion: 'reduce',
    })
    const page = await context.newPage()
    await page.goto(BASE + shot.route)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(900)
    if (shot.ready) await page.getByText(shot.ready).first().waitFor({ timeout: 10_000 })
    if (shot.before) await shot.before(page)
    if (shot.scrollTo) {
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
  stopPostgres()
}
