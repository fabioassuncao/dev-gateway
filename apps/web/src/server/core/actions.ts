// What the panel is allowed to do to a container, and to which container.
//
// Two rules run through everything here:
//   - the panel never manages the gateway's own containers by accident: those
//     are reached through /api/gateway and /api/access, which know what they
//     are doing;
//   - a removal takes the container and nothing else. No volume, no network,
//     no image, no sibling in the same Compose project.

import type { DockerClient } from '../docker/client.ts'
import type { Snapshot } from './inventory.ts'
import type { ContainerSummary, RemovalPreview } from '../../shared/types.ts'

export type ContainerAction = 'start' | 'stop' | 'restart'

export class ActionRefused extends Error {
  status: number
  hint: string
  constructor(message: string, hint = '', status = 403) {
    super(message)
    this.name = 'ActionRefused'
    this.hint = hint
    this.status = status
  }
}

export function findContainer(snapshot: Snapshot, id: string): ContainerSummary {
  const container =
    snapshot.containers.find((item) => item.id === id) ??
    snapshot.containers.find((item) => item.id.startsWith(id)) ??
    snapshot.containers.find((item) => item.name === id)
  if (!container) {
    throw new ActionRefused(`no container '${id}' on this host`, 'it may have been removed already', 404)
  }
  return container
}

function assertNotGatewayOwned(container: ContainerSummary, verb: string): void {
  if (container.ownership !== 'gateway') return
  if (container.gatewayComponent === 'access-bridge') {
    throw new ActionRefused(
      `${container.name} is a TCP access bridge`,
      'close it from the Access page, which removes it cleanly',
    )
  }
  if (container.gatewayComponent === 'access-forwarder') {
    throw new ActionRefused(
      `${container.name} is a published TCP forwarder`,
      `remove it with: portta service unpublish ${container.labels['portta.forward.alias'] ?? ''}`.trim(),
    )
  }
  throw new ActionRefused(
    `refusing to ${verb} ${container.name}: it is a Portta component`,
    'gateway components are restarted from the Gateway page, or with portta restart',
  )
}

export async function runContainerAction(
  client: DockerClient,
  snapshot: Snapshot,
  id: string,
  action: ContainerAction,
): Promise<ContainerSummary> {
  const container = findContainer(snapshot, id)
  assertNotGatewayOwned(container, action)

  if (action === 'start' && container.state === 'running') {
    throw new ActionRefused(`${container.name} is already running`, '', 409)
  }
  if (action === 'stop' && container.state !== 'running' && container.state !== 'restarting') {
    throw new ActionRefused(`${container.name} is not running`, '', 409)
  }

  if (action === 'start') await client.start(container.id)
  else if (action === 'stop') await client.stop(container.id)
  else await client.restart(container.id)

  return container
}

export function removalPreview(snapshot: Snapshot, id: string): RemovalPreview {
  const container = findContainer(snapshot, id)
  const namedVolumes = container.mounts
    .filter((mount) => mount.type === 'volume' && mount.name)
    .map((mount) => mount.name as string)
  const binds = container.mounts.filter((mount) => mount.type === 'bind')

  const warnings: string[] = []
  let allowed = true

  if (container.ownership === 'gateway') {
    allowed = false
    warnings.push('this is a Portta component; the panel does not remove its own infrastructure')
  }
  if (container.state === 'running') {
    warnings.push('the container is running and will be stopped first')
  }
  if (namedVolumes.length > 0) {
    warnings.push(
      `${namedVolumes.length} named volume(s) stay on the host: ${namedVolumes.join(', ')}`,
    )
  }
  if (binds.length > 0) {
    warnings.push(`${binds.length} bind mount(s) point at the host and are never touched`)
  }
  if (container.project) {
    warnings.push(
      `belongs to the Compose project "${container.project}"; running docker compose up there recreates it`,
    )
  }
  if (container.networks.length > 0) {
    warnings.push(`networks are kept: ${container.networks.join(', ')}`)
  }

  return {
    containerId: container.id,
    name: container.name,
    image: container.image,
    ownership: container.ownership,
    state: container.state,
    project: container.project,
    mounts: container.mounts,
    namedVolumes,
    networks: container.networks,
    warnings,
    allowed,
  }
}

export async function removeContainer(
  client: DockerClient,
  snapshot: Snapshot,
  id: string,
  options: { force: boolean },
): Promise<ContainerSummary> {
  const container = findContainer(snapshot, id)
  assertNotGatewayOwned(container, 'remove')

  if (container.state === 'running' && !options.force) {
    throw new ActionRefused(
      `${container.name} is running`,
      'stop it first, or confirm the removal explicitly',
      409,
    )
  }

  // `remove` in the client hard-codes v=0 and link=0: volumes and networks
  // outlive the container, always.
  await client.remove(container.id, container.state === 'running')
  return container
}
