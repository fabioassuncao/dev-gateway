#!/usr/bin/env node
// Boots the panel against a fake Docker Engine API, so the end-to-end run
// needs no Docker daemon and describes a known host every time.

import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
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

docker.listen(DOCKER_PORT, '127.0.0.1', () => {
  process.stdout.write(`fake docker api on 127.0.0.1:${DOCKER_PORT}\n`)

  const panel = spawn(process.execPath, [join(root, 'dist/server/index.js')], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      PORTTA_RUNTIME_DOCKER_API: `http://127.0.0.1:${DOCKER_PORT}`,
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
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  panel.on('exit', (code) => process.exit(code ?? 0))
})
