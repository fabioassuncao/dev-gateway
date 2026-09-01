import { z } from 'zod'
import type { ContainerRecord } from '@dev-gateway/core'
import { PreconditionError, UsageError } from './errors.js'
import { runProcess } from './process.js'

const Identifier = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/

export function identifier(value: string, kind = 'Docker identifier'): string {
  if (!Identifier.test(value)) throw new UsageError(`invalid ${kind}: ${value}`)
  return value
}

const InspectSchema = z.object({
  Id: z.string(),
  Name: z.string(),
  Config: z.object({ Image: z.string(), Labels: z.record(z.string(), z.string()).nullable().optional() }).passthrough(),
  State: z.object({ Status: z.string() }).passthrough(),
  NetworkSettings: z.object({
    Networks: z.record(z.string(), z.unknown()).nullable().optional(),
    Ports: z.record(z.string(), z.array(z.object({ HostIp: z.string().optional(), HostPort: z.string().optional() })).nullable()).nullable().optional(),
  }).passthrough(),
}).passthrough()

export async function dockerAvailable(): Promise<boolean> {
  const result = await runProcess('docker', ['info'], { reject: false })
  return result.exitCode === 0
}

export async function requireDocker(): Promise<void> {
  if (!(await dockerAvailable())) throw new PreconditionError('cannot talk to the Docker daemon', 'start Docker or check DOCKER_HOST')
}

export async function inspectContainers(all = true): Promise<ContainerRecord[]> {
  await requireDocker()
  const listed = await runProcess('docker', ['ps', all ? '-aq' : '-q'])
  const ids = listed.stdout.split(/\s+/).filter(Boolean)
  if (ids.length === 0) return []
  const result = await runProcess('docker', ['inspect', ...ids])
  const parsed = z.array(InspectSchema).parse(JSON.parse(result.stdout))
  return parsed.map((item) => {
    const ports: ContainerRecord['ports'] = []
    for (const [privateSpec, bindings] of Object.entries(item.NetworkSettings.Ports ?? {})) {
      const [privateText, type = 'tcp'] = privateSpec.split('/')
      if (!bindings?.length) ports.push({ ip: '', privatePort: Number(privateText), publicPort: null, type })
      else for (const binding of bindings) ports.push({ ip: binding.HostIp ?? '', privatePort: Number(privateText), publicPort: binding.HostPort ? Number(binding.HostPort) : null, type })
    }
    return {
      id: item.Id,
      name: item.Name.replace(/^\//, ''),
      image: item.Config.Image,
      state: item.State.Status,
      labels: item.Config.Labels ?? {},
      ports,
      networks: Object.keys(item.NetworkSettings.Networks ?? {}).sort(),
    }
  })
}

export async function networkExists(name: string): Promise<boolean> {
  const result = await runProcess('docker', ['network', 'inspect', identifier(name, 'network name')], { reject: false })
  return result.exitCode === 0
}

export async function ensureNetwork(name: string): Promise<'ok' | 'created'> {
  if (await networkExists(name)) return 'ok'
  await runProcess('docker', ['network', 'create', '--label', 'dev-gateway.managed=true', '--label', 'dev-gateway.component=shared-network', identifier(name, 'network name')])
  return 'created'
}

export async function isManagedContainer(id: string): Promise<boolean> {
  const result = await runProcess('docker', ['inspect', identifier(id), '--format', '{{ index .Config.Labels "dev-gateway.managed" }}'], { reject: false })
  return result.exitCode === 0 && result.stdout.trim() === 'true'
}
