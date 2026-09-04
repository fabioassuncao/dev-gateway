import { defineConfig } from 'vitest/config'

// Node, never jsdom: everything here is a service, a route or a repository, and
// a browser environment costs roughly ten times what this one does.
//
// The timeout is generous because the first test in each file pays for
// compiling PGlite's WebAssembly — about three seconds, once per worker. Every
// test after it costs a hundred milliseconds, and the default five seconds
// failed the first one in each file and nothing else.
export default defineConfig({
  test: {
    name: 'server',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
  },
})
