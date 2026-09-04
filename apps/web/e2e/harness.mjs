#!/usr/bin/env node
// Boots the panel against a fake Docker Engine API, so the end-to-end run
// needs no Docker daemon and describes a known host every time.

import { createServer } from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { makeBridge } from './container.mjs'

// Which host to describe. The end-to-end suite uses the small one; the
// documentation screenshots pass demo-host.mjs.
const { initialState, NETWORKS, INFO } = await import(process.env.PORTTA_E2E_FIXTURE ?? './fixtures.mjs')

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const DOCKER_PORT = Number(process.env.PORTTA_E2E_DOCKER_PORT ?? 9911)
const PANEL_PORT = Number(process.env.PORTTA_E2E_PANEL_PORT ?? 9912)

let containers = initialState()

function json(res, body, status = 200) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) })
  res.end(payload)
}

function logFrames(lines) {
  return Buffer.concat(
    lines.map(([stream, text]) => {
      const payload = Buffer.from(`${text}\n`, 'utf8')
      const header = Buffer.alloc(8)
      header[0] = stream
      header.writeUInt32BE(payload.length, 4)
      return Buffer.concat([header, payload])
    }),
  )
}

const docker = createServer((req, res) => {
  const url = new URL(req.url, 'http://docker')
  const path = url.pathname.replace(/^\/v[\d.]+/, '')
  const match = (pattern) => pattern.exec(path)

  // Not a Docker endpoint: it lets each test start from the same host.
  if (path === '/__reset' && req.method === 'POST') {
    containers = initialState()
    return json(res, { ok: true })
  }

  // Finish the applier on demand. The suite drives the transition rather than
  // waiting for one, so "the apply ended" is a step in the test and not a race
  // against a timer.
  if (path === '/__finish-apply' && req.method === 'POST') {
    const found = containers.find((c) => c.id === 'gwapply')
    if (!found) return json(res, { message: 'no applier' }, 404)
    found.state = 'exited'
    found.item.State = 'exited'
    found.item.Status = 'Exited just now'
    found.inspect.State.Status = 'exited'
    found.inspect.State.Running = false
    found.inspect.State.ExitCode = Number(url.searchParams.get('code') ?? 0)
    found.inspect.State.FinishedAt = new Date().toISOString()
    return json(res, { ok: true })
  }

  if (path === '/_ping') return res.end('OK')
  if (path === '/version') {
    return json(res, { Version: '29.4.0', ApiVersion: '1.51', Os: 'linux', Arch: 'arm64' })
  }
  if (path === '/info') {
    const running = containers.filter((c) => c.state === 'running').length
    return json(res, {
      Name: 'e2e-host',
      Images: 20,
      NCPU: 8,
      MemTotal: 17179869184,
      OperatingSystem: 'End-to-end Linux',
      Architecture: 'aarch64',
      ServerVersion: '29.4.0',
      ...(INFO ?? {}),
      // Always counted from the containers that exist right now.
      Containers: containers.length,
      ContainersRunning: running,
      ContainersPaused: 0,
      ContainersStopped: containers.length - running,
    })
  }
  if (path === '/containers/json') return json(res, containers.map((c) => c.item))
  if (path === '/networks') return json(res, NETWORKS)

  if (path === '/events') {
    res.writeHead(200, { 'content-type': 'application/json' })
    // Held open: the panel subscribes once and waits.
    return
  }

  let m
  if ((m = match(/^\/containers\/([^/]+)\/json$/))) {
    const found = containers.find((c) => c.id === m[1])
    return found ? json(res, found.inspect) : json(res, { message: 'no such container' }, 404)
  }
  if ((m = match(/^\/containers\/([^/]+)\/logs$/))) {
    res.writeHead(200, { 'content-type': 'application/vnd.docker.multiplexed-stream' })
    return res.end(
      logFrames([
        [1, '2026-01-01T10:00:01Z starting up'],
        [1, '2026-01-01T10:00:02Z ready to accept connections'],
        [2, '2026-01-01T10:00:03Z a warning nobody reads'],
      ]),
    )
  }
  if ((m = match(/^\/containers\/([^/]+)\/(start|stop|restart)$/))) {
    const found = containers.find((c) => c.id === m[1])
    if (!found) return json(res, { message: 'no such container' }, 404)
    if (m[2] === 'stop') {
      found.state = 'exited'
      found.item.State = 'exited'
      found.item.Status = 'Exited (0) just now'
      found.inspect.State.Status = 'exited'
      found.inspect.State.Running = false
    } else {
      found.state = 'running'
      found.item.State = 'running'
      found.item.Status = 'Up 1 second'
      found.inspect.State.Status = 'running'
      found.inspect.State.Running = true
      // A started container has a start time. Without this a one-shot that was
      // just started still reads as "created and never run".
      found.inspect.State.StartedAt = new Date().toISOString()
    }
    res.writeHead(204)
    return res.end()
  }
  if (path === '/containers/create' && req.method === 'POST') {
    // Faithful enough to matter: the created bridge joins the list, so the
    // panel shows it the way it would after a real `access open`.
    let raw = ''
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {}
      const name = url.searchParams.get('name') ?? 'portta-access-created'
      const id = `bridge${containers.length}`
      const targetPort = Number(Object.keys(body.ExposedPorts ?? { '5432/tcp': {} })[0].split('/')[0])
      containers.push(
        makeBridge({ id, name, labels: body.Labels ?? {}, targetPort, hostPort: 55432 }),
      )
      json(res, { Id: id, Warnings: [] }, 201)
    })
    return
  }
  if ((m = match(/^\/containers\/([^/]+)$/)) && req.method === 'DELETE') {
    containers = containers.filter((c) => c.id !== m[1])
    res.writeHead(204)
    return res.end()
  }

  return json(res, { message: `unexpected call: ${req.method} ${path}` }, 500)
})

// PostgreSQL is a boot dependency of the panel: it exits rather than serving
// without one. The Docker *Engine API* the panel talks to is still the fake
// above — this is a real container for a real database, and the only reason the
// panel end-to-end run now needs a daemon.
// A fixed name, so the `docker rm -f` below always clears the one a killed run
// left behind. A name with the pid in it would leave a container holding the
// port and no way to find it.
const DB_NAME = 'portta-e2e-db'
const DB_PORT = Number(process.env.PORTTA_E2E_DB_PORT ?? 9913)
const DATABASE_URL = process.env.PORTTA_E2E_DATABASE_URL ?? `postgres://portta:portta@127.0.0.1:${DB_PORT}/portta`

function run(command, args) {
  return spawnSync(command, args, { encoding: 'utf8' })
}

function startDatabase() {
  if (process.env.PORTTA_E2E_DATABASE_URL) return () => undefined

  if (run('docker', ['info']).status !== 0) {
    process.stderr.write(
      'the panel end-to-end run needs a PostgreSQL, and PostgreSQL is a boot dependency of the panel.\n' +
        'Start Docker, or point PORTTA_E2E_DATABASE_URL at a database you already have.\n',
    )
    process.exit(1)
  }

  run('docker', ['rm', '-f', DB_NAME])
  const started = run('docker', [
    'run', '--rm', '-d', '--name', DB_NAME,
    '-e', 'POSTGRES_USER=portta', '-e', 'POSTGRES_PASSWORD=portta', '-e', 'POSTGRES_DB=portta',
    '-p', `127.0.0.1:${DB_PORT}:5432`,
    'postgres:18.6-alpine',
  ])
  if (started.status !== 0) {
    process.stderr.write(`could not start the end-to-end database: ${started.stderr}\n`)
    process.exit(1)
  }

  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (run('docker', ['exec', DB_NAME, 'pg_isready', '-U', 'portta']).status === 0) {
      process.stdout.write(`end-to-end database on 127.0.0.1:${DB_PORT}\n`)
      return () => run('docker', ['rm', '-f', DB_NAME])
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500)
  }
  run('docker', ['rm', '-f', DB_NAME])
  process.stderr.write('the end-to-end database never became ready\n')
  process.exit(1)
}

const stopDatabase = startDatabase()

docker.listen(DOCKER_PORT, '127.0.0.1', () => {
  process.stdout.write(`fake docker api on 127.0.0.1:${DOCKER_PORT}\n`)

  const panel = spawn(process.execPath, [join(root, 'dist/server.mjs')], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORTTA_RUNTIME_DOCKER_API: `http://127.0.0.1:${DOCKER_PORT}`,
      PORTTA_RUNTIME_DATABASE_URL: DATABASE_URL,
      PORTTA_RUNTIME_HOST: '127.0.0.1',
      PORTTA_RUNTIME_PORT: String(PANEL_PORT),
      PORTTA_RUNTIME_ENV_FILE: join(root, 'e2e/env.fixture'),
      PORTTA_RUNTIME_VERSION_FILE: join(root, 'e2e/VERSION.fixture'),
      PORTTA_RUNTIME_BRIDGE_SETTLE_MS: '0',
      PORTTA_PROFILE: 'local',
      PORTTA_DOMAIN: 'localhost',
      PORTTA_NETWORK: 'portta',
    },
  })

  const shutdown = () => {
    panel.kill('SIGTERM')
    docker.close()
    stopDatabase()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  panel.on('exit', (code) => {
    stopDatabase()
    process.exit(code ?? 0)
  })
})
