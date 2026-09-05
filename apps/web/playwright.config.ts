import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  globalSetup: './e2e/build.mjs',
  reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }]],
  use: { trace: 'retain-on-failure' },
  // Each spec owns a worker fixture, PostgreSQL and panel. A retry gets a new
  // worker too; it cannot inherit users or containers from the failed attempt.
  projects: ['panel', 'infrastructure', 'development', 'auth', 'roles', 'settings'].map((name) => ({
    name, testMatch: `${name}.spec.ts`, use: { ...devices['Desktop Chrome'] },
  })),
})
