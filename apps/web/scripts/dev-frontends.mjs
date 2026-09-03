// The panel UI and the documentation site are two Vite apps. In development
// the browser talks to one port (5173); this starts both processes and the
// UI Vite proxies /docs to the documentation one. HMR stays on the panel
// only: the docs server has it off, so nothing needs to publish 5174.

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const vite = join(dirname(require.resolve('vite/package.json')), 'bin/vite.js')

const children = []
let exiting = false

function start(args) {
  const child = spawn(process.execPath, [vite, ...args], { stdio: 'inherit' })
  children.push(child)
  child.on('exit', (code, signal) => {
    if (exiting) return
    exiting = true
    for (const other of children) {
      if (other !== child && !other.killed) other.kill('SIGTERM')
    }
    process.exit(code ?? (signal ? 1 : 0))
  })
  child.on('error', (error) => {
    console.error(error)
    if (exiting) return
    exiting = true
    for (const other of children) {
      if (!other.killed) other.kill('SIGTERM')
    }
    process.exit(1)
  })
}

function shutdown(signal) {
  if (exiting) return
  exiting = true
  for (const child of children) {
    if (!child.killed) child.kill(signal)
  }
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

start(['--config', 'vite.docs.config.ts'])
start([])
