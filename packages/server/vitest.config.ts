import { defineConfig } from 'vitest/config'

// Node, never jsdom: everything here is a service, a route or a repository,
// and a browser environment costs roughly ten times what this one does.
export default defineConfig({
  test: {
    name: 'server',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
