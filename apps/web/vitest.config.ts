import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['tests/server/**/*.test.ts'],
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
