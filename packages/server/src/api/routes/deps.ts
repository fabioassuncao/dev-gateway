import type { DockerClient } from '../../services/docker/client.ts'
import type { PanelConfig } from '../../config.ts'
import type { SnapshotCache } from '../../services/inventory.ts'
import type { LiveHub } from '../../services/events.ts'
import type { VerdictCache } from '../../services/traefik.ts'
import type { Database } from '../../db/index.ts'
import type { GitHubIntegration } from '../../services/integrations/github/index.ts'

export interface AppDeps {
  config: PanelConfig
  client: DockerClient
  cache: SnapshotCache
  hub: LiveHub
  /** Traefik's own view, on its own cache. Never on the snapshot path. */
  verdict: VerdictCache
  /**
   * Required. PostgreSQL is a boot dependency: `main` exits rather than serving
   * a panel that cannot remember anything. A connection that drops *after* boot
   * is a different thing, and `requireDatabase` still turns it into a 503.
   */
  db: Database
  /** Optional by design: every pre-integration endpoint works with null. */
  github: GitHubIntegration | null
}
