import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Two projects. The API's suites moved to portta-server with the code they
// cover; what is left is the panel itself, which needs a DOM, and the build-time
// documentation collector, which reads the repository and must not have one.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'docs',
          environment: 'node',
          include: ['tests/docs/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'ui',
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./tests/ui/setup.ts'],
          include: ['tests/ui/**/*.test.tsx', 'tests/ui/**/*.test.ts'],
        },
      },
    ],
  },
})
