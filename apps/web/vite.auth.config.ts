import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: 'src/auth',
  base: '/__portta/auth/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../../dist/auth',
    emptyOutDir: true,
  },
})
