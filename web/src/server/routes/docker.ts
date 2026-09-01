import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import type { AppDeps } from './deps.ts'
import { findContainer, removalPreview, removeContainer, runContainerAction } from '../core/actions.ts'
import { readLogs } from './services.ts'
import type { DockerHost, Ownership } from '../../shared/types.ts'

const ownershipFilter = z.enum(['all', 'gateway', 'integrated', 'external', 'standalone'])
const stateFilter = z.enum(['all', 'running', 'stopped', 'unhealthy'])

const removeBody = z
  .object({ confirm: z.literal(true), force: z.boolean().optional() })
  .strict()

export function dockerRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  // Every container on the host, gateway-owned or not. The classification
  // travels with each row so the UI never has to guess.
  app.get('/docker/containers', async (c) => {
    const snapshot = await deps.cache.get()
    const ownership = ownershipFilter.catch('all').parse(c.req.query('ownership'))
    const state = stateFilter.catch('all').parse(c.req.query('state'))
    const search = (c.req.query('q') ?? '').trim().toLowerCase()

    const containers = snapshot.containers.filter((container) => {
      if (ownership !== 'all' && container.ownership !== (ownership as Ownership)) return false
      if (state === 'running' && container.state !== 'running') return false
      if (state === 'stopped' && container.state === 'running') return false
      if (state === 'unhealthy' && container.health !== 'unhealthy') return false
      if (search !== '') {
        const haystack = [
          container.name,
          container.image,
          container.project ?? '',
          container.service ?? '',
          ...container.urls.map((url) => url.host),
        ]
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(search)) return false
      }
      return true
    })

    return c.json({ containers, total: snapshot.containers.length })
  })

  app.get('/docker/containers/:id', async (c) => {
    const snapshot = await deps.cache.get()
    return c.json(findContainer(snapshot, c.req.param('id')))
  })

  app.get('/docker/containers/:id/logs', async (c) =>
    c.json(await readLogs(deps, c.req.param('id'), c.req.query('tail'))),
  )

  // Optional and cheap: one shot, never a stream. Nothing else depends on it.
  app.get('/docker/containers/:id/stats', async (c) => {
    const snapshot = await deps.cache.get()
    const container = findContainer(snapshot, c.req.param('id'))
    if (container.state !== 'running') return c.json({ cpuPercent: null, memoryBytes: null, memoryLimit: null })
    const stats = await deps.client.stats(container.id).catch(() => null)
    if (!stats) return c.json({ cpuPercent: null, memoryBytes: null, memoryLimit: null })

    const cpuDelta =
      (stats.cpu_stats?.cpu_usage?.total_usage ?? 0) - (stats.precpu_stats?.cpu_usage?.total_usage ?? 0)
    const systemDelta =
      (stats.cpu_stats?.system_cpu_usage ?? 0) - (stats.precpu_stats?.system_cpu_usage ?? 0)
    const cpus = stats.cpu_stats?.online_cpus ?? 1
    const cpuPercent = systemDelta > 0 && cpuDelta > 0 ? (cpuDelta / systemDelta) * cpus * 100 : 0

    const cache = stats.memory_stats?.stats?.['inactive_file'] ?? 0
    const memoryBytes = Math.max(0, (stats.memory_stats?.usage ?? 0) - cache)

    return c.json({
      cpuPercent: Number(cpuPercent.toFixed(1)),
      memoryBytes,
      memoryLimit: stats.memory_stats?.limit ?? null,
    })
  })

  // What a removal would take with it, so the confirmation can be specific.
  app.get('/docker/containers/:id/removal-preview', async (c) => {
    const snapshot = await deps.cache.get()
    return c.json(removalPreview(snapshot, c.req.param('id')))
  })

  for (const action of ['start', 'stop', 'restart'] as const) {
    app.post(`/docker/containers/:id/${action}`, async (c) => {
      const snapshot = await deps.cache.get()
      const container = await runContainerAction(deps.client, snapshot, c.req.param('id'), action)
      deps.cache.invalidate()
      return c.json({
        ok: true,
        action,
        containerId: container.id,
        message: `${action} sent to ${container.name}`,
      })
    })
  }

  app.delete('/docker/containers/:id', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const parsed = removeBody.safeParse(body)
    if (!parsed.success) {
      throw new HTTPException(400, {
        message: 'a removal has to be confirmed explicitly: send {"confirm": true}',
      })
    }

    const snapshot = await deps.cache.get()
    const container = await removeContainer(deps.client, snapshot, c.req.param('id'), {
      force: parsed.data.force === true,
    })
    deps.cache.invalidate()
    return c.json({
      ok: true,
      action: 'remove',
      containerId: container.id,
      message: `removed ${container.name}; volumes, networks and images were kept`,
    })
  })

  app.get('/docker/host', async (c) => {
    const snapshot = await deps.cache.get()
    const count = (ownership: Ownership) =>
      snapshot.containers.filter((container) => container.ownership === ownership).length

    const host: DockerHost = {
      engine: {
        version: snapshot.version?.Version ?? snapshot.info?.ServerVersion ?? 'unknown',
        apiVersion: snapshot.version?.ApiVersion ?? 'unknown',
        os: snapshot.info?.OperatingSystem ?? snapshot.version?.Os ?? 'unknown',
        arch: snapshot.info?.Architecture ?? snapshot.version?.Arch ?? 'unknown',
        cpus: snapshot.info?.NCPU ?? 0,
        memoryBytes: snapshot.info?.MemTotal ?? 0,
        name: snapshot.info?.Name ?? 'unknown',
      },
      containers: {
        total: snapshot.info?.Containers ?? snapshot.containers.length,
        running:
          snapshot.info?.ContainersRunning ??
          snapshot.containers.filter((container) => container.state === 'running').length,
        paused: snapshot.info?.ContainersPaused ?? 0,
        stopped:
          snapshot.info?.ContainersStopped ??
          snapshot.containers.filter((container) => container.state !== 'running').length,
      },
      byOwnership: {
        gateway: count('gateway'),
        integrated: count('integrated'),
        external: count('external'),
        standalone: count('standalone'),
      },
      networks: snapshot.networks,
      ports: snapshot.ports,
    }
    return c.json(host)
  })

  return app
}
