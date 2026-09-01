// Label names the gateway and Compose already use. The panel reads them; it
// never writes a label of its own except on the access bridges it creates,
// which must be indistinguishable from the ones `dev-gateway access open`
// creates so the CLI keeps managing them.

export const LABELS = {
  managed: 'dev-gateway.managed',
  component: 'dev-gateway.component',

  // Optional, and optional on purpose: everything below is inferred from the
  // Compose labels when it is absent, and a project that sets none behaves
  // exactly as it did before they existed. See
  // docs/adr/0010-git-collected-on-the-host.md.
  //
  //   project   the logical project, when COMPOSE_PROJECT_NAME is a per-worktree
  //             namespace and several worktrees belong under one heading
  //   repo      `owner/name` or a remote URL, which gives forge links with no
  //             host-side Git at all
  //   gitRoot   the repository root, when the Compose file is not at it
  //   issue     `owner/name#123`, or `#123` when the repository is unambiguous,
  //             when this environment is running for one issue
  project: 'dev-gateway.project',
  repo: 'dev-gateway.repo',
  gitRoot: 'dev-gateway.git.root',
  issue: 'dev-gateway.issue',

  composeProject: 'com.docker.compose.project',
  composeService: 'com.docker.compose.service',
  composeWorkingDir: 'com.docker.compose.project.working_dir',
  composeConfigFiles: 'com.docker.compose.project.config_files',
  composeContainerNumber: 'com.docker.compose.container-number',

  traefikEnable: 'traefik.enable',

  accessId: 'dev-gateway.access.id',
  accessProject: 'dev-gateway.access.project',
  accessService: 'dev-gateway.access.service',
  accessPort: 'dev-gateway.access.port',
  accessNetwork: 'dev-gateway.access.network',
  accessKind: 'dev-gateway.access.kind',
  accessCreated: 'dev-gateway.access.created',
  accessExpires: 'dev-gateway.access.expires',

  forwardAlias: 'dev-gateway.forward.alias',
  forwardProject: 'dev-gateway.forward.project',
  forwardService: 'dev-gateway.forward.service',
  forwardPort: 'dev-gateway.forward.port',
  forwardKind: 'dev-gateway.forward.kind',
} as const

/** Labels worth showing in the UI. Everything else is noise on a detail panel. */
const INTERESTING_PREFIXES = ['dev-gateway.', 'traefik.', 'com.docker.compose.project', 'org.opencontainers.']
const INTERESTING_EXACT: string[] = [LABELS.composeProject, LABELS.composeService, LABELS.traefikEnable]

export function relevantLabels(labels: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(labels ?? {})) {
    if (INTERESTING_EXACT.includes(key) || INTERESTING_PREFIXES.some((p) => key.startsWith(p))) {
      out[key] = value
    }
  }
  return out
}
