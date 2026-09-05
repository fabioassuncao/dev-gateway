// Resources belong to one invocation. Never discover/reuse another run's DB.
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { join } from 'node:path'

export const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

export async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}

export async function startPostgres({ command = docker } = {}) {
  const owner = randomUUID()
  const name = `portta-e2e-${owner}`
  const containers = []
  let network
  let closed = false
  const started = performance.now()
  const close = async () => {
    if (closed) return
    closed = true
    const start = performance.now()
    for (const id of containers.reverse()) {
      if (command('inspect', '-f', '{{index .Config.Labels "portta.e2e.run"}}', id) !== owner) throw new Error(`Refusing cleanup: ownership changed for ${id}`)
      command('rm', '-f', id)
    }
    if (network) {
      if (command('network', 'inspect', '-f', '{{index .Labels "portta.e2e.run"}}', network) !== owner) throw new Error('Network ownership changed')
      command('network', 'rm', network)
    }
    console.log(`E2E database teardown: ${((performance.now() - start) / 1000).toFixed(3)}s`)
  }
  try {
    network = command('network', 'create', '--label', `portta.e2e.run=${owner}`, name)
    const database = command('run', '-d', '--name', `${name}-db`, '--network', name,
      '--label', `portta.e2e.run=${owner}`, '-e', 'POSTGRES_USER=portta', '-e', 'POSTGRES_PASSWORD=portta', '-e', 'POSTGRES_DB=portta', 'postgres:18.6-alpine')
    containers.push(database)
    let ready = false
    for (let i = 0; i < 120; i++) {
      try { command('exec', database, 'pg_isready', '-U', 'portta'); ready = true; break } catch { await pause(250) }
    }
    if (!ready) throw new Error('Disposable PostgreSQL did not become ready')
    // The datastore has no host port. A dedicated access bridge binds loopback.
    const bridge = command('run', '-d', '--name', `${name}-bridge`, '--network', name,
      '--label', `portta.e2e.run=${owner}`, '-p', '127.0.0.1::5432', 'alpine/socat:1.8.1.3',
      'TCP-LISTEN:5432,fork,reuseaddr', `TCP:${name}-db:5432`)
    containers.push(bridge)
    const binding = command('port', bridge, '5432/tcp')
    if (!/^127\.0\.0\.1:\d+$/.test(binding)) throw new Error('Access bridge did not bind exclusively to loopback')
    console.log(`E2E database + readiness + bridge: ${((performance.now() - started) / 1000).toFixed(3)}s`)
    return { url: `postgres://portta:portta@${binding}/portta`, close }
  } catch (error) {
    await close()
    throw error
  }
}

export async function startPanel({ mode = 'disabled', fixture, env = {} } = {}) {
  const database = await startPostgres()
  let child
  let startupError
  let output = ''
  const close = async () => {
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill('SIGTERM')
      const timer = setTimeout(() => {
        if (process.platform === 'win32') child.kill('SIGKILL')
        else { try { process.kill(-child.pid, 'SIGKILL') } catch { /* already exited */ } }
      }, 5000)
      await exited
      clearTimeout(timer)
    }
    await database.close()
  }
  try {
    const port = await freePort(), enginePort = await freePort()
    const url = `http://127.0.0.1:${port}`, engineURL = `http://127.0.0.1:${enginePort}`
    const started = performance.now()
    child = spawn(process.execPath, [join(import.meta.dirname, 'harness.mjs')], {
      cwd: join(import.meta.dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      env: { ...process.env, ...env, PORTTA_E2E_DATABASE_URL: database.url,
        PORTTA_E2E_PANEL_PORT: String(port), PORTTA_E2E_DOCKER_PORT: String(enginePort),
        PORTTA_E2E_AUTH_MODE: mode, ...(fixture ? { PORTTA_E2E_FIXTURE: fixture } : {}) },
    })
    child.on('error', (error) => { startupError = error; output += error.message })
    child.stdout.on('data', (data) => { output += data })
    child.stderr.on('data', (data) => { output += data })
    for (let attempt = 0; attempt < 120; attempt++) {
      if (startupError) throw startupError
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Panel exited during startup:\n${output}`)
      try {
        const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1000) })
        // The owned process must have reported its successful listen callback.
        // A health response from an unrelated process winning the port race
        // cannot make this fixture reuse that server.
        if (response.ok && output.includes(`listening on ${url}`) && child.exitCode === null) {
          console.log(`E2E panel startup (includes migrations/seed): ${((performance.now() - started) / 1000).toFixed(3)}s`)
          return { url, engineURL, databaseURL: database.url, close, logs: () => output }
        }
      } catch { /* bounded readiness wait */ }
      await pause(250)
    }
    throw new Error(`Panel did not become ready:\n${output}`)
  } catch (error) { await close(); throw error }
}
