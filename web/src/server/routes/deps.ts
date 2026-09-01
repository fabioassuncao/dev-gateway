import type { DockerClient } from '../docker/client.ts'
import type { PanelConfig } from '../config.ts'
import type { SnapshotCache } from '../core/inventory.ts'
import type { LiveHub } from '../core/events.ts'
import type { VerdictCache } from '../core/traefik.ts'

export interface AppDeps {
  config: PanelConfig
  client: DockerClient
  cache: SnapshotCache
  hub: LiveHub
  /** Traefik's own view, on its own cache. Never on the snapshot path. */
  verdict: VerdictCache
}
