import type { DockerClient } from '../docker/client.ts'
import type { PanelConfig } from '../config.ts'
import type { SnapshotCache } from '../core/inventory.ts'
import type { LiveHub } from '../core/events.ts'
import type { VerdictCache } from '../core/traefik.ts'
import type { Database } from '../db/index.ts'
import type { GitHubIntegration } from '../integrations/github/index.ts'

export interface AppDeps {
  config: PanelConfig
  client: DockerClient
  cache: SnapshotCache
  hub: LiveHub
  /** Traefik's own view, on its own cache. Never on the snapshot path. */
  verdict: VerdictCache
  /** Optional by design: every pre-persistence endpoint works with null. */
  db: Database | null
  /** Optional by design: every pre-integration endpoint works with null. */
  github: GitHubIntegration | null
}
