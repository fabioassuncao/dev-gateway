// The checks the panel can make honestly from inside a container.
//
// This is deliberately not a reimplementation of `dev-gateway doctor`: that
// runs on the host and inspects things a container cannot see truthfully
// (binaries in PATH, listening sockets, DNS resolution, certificate files on
// disk). What is here is everything derivable from Docker and the resolved
// configuration, which is exactly what the panel already has.

import type { PanelConfig } from '../config.ts'
import { isAuthenticated, isRouted } from '../config.ts'
import { GENERATED_FILES, isDirWritable, readGenerated, renderPanelAuth } from './dynamic.ts'
import type { Snapshot } from './inventory.ts'
import { componentOf } from './gateway.ts'
import type { Diagnostic } from '../../shared/types.ts'

function check(
  id: string,
  status: Diagnostic['status'],
  title: string,
  detail: string,
  fix = '',
): Diagnostic {
  return { id, status, title, detail, fix }
}

export function diagnose(snapshot: Snapshot, config: PanelConfig): Diagnostic[] {
  const results: Diagnostic[] = []

  if (!snapshot.reachable) {
    results.push(
      check(
        'docker',
        'fail',
        'Docker API',
        'the panel cannot reach its socket proxy',
        'dev-gateway web restart',
      ),
    )
    return results
  }
  results.push(check('docker', 'pass', 'Docker API', 'reachable through the panel socket proxy'))

  const traefik = componentOf(snapshot, 'traefik')
  if (!traefik) {
    results.push(check('traefik', 'fail', 'Traefik', 'no gateway container found', `dev-gateway up ${config.profile}`))
  } else if (traefik.state !== 'running') {
    results.push(check('traefik', 'fail', 'Traefik', `container is ${traefik.state}`, `dev-gateway up ${config.profile}`))
  } else if (traefik.health === 'unhealthy') {
    results.push(check('traefik', 'fail', 'Traefik', 'container is unhealthy', 'dev-gateway logs traefik'))
  } else if (traefik.health === 'starting') {
    results.push(check('traefik', 'warn', 'Traefik', 'health check is still starting', ''))
  } else {
    results.push(check('traefik', 'pass', 'Traefik', `running (${traefik.health})`))
  }

  const proxy = componentOf(snapshot, 'socket-proxy')
  if (!proxy || proxy.state !== 'running') {
    results.push(
      check('socket-proxy', 'fail', 'Traefik socket proxy', proxy ? `container is ${proxy.state}` : 'missing', `dev-gateway up ${config.profile}`),
    )
  } else {
    results.push(check('socket-proxy', 'pass', 'Traefik socket proxy', 'running'))
  }

  const network = snapshot.networks.find((item) => item.name === config.network)
  if (!network) {
    results.push(
      check('network', 'fail', 'Shared network', `${config.network} does not exist`, 'dev-gateway bootstrap'),
    )
  } else {
    results.push(
      check('network', 'pass', 'Shared network', `${config.network}: ${network.containerCount} container(s) attached`),
    )
  }

  // A project that opted into Traefik but never joined the shared network is
  // the single most common adoption mistake, and Traefik reports nothing.
  const orphanRoutes = snapshot.containers.filter(
    (container) =>
      container.ownership !== 'gateway' &&
      container.traefikEnabled &&
      container.state === 'running' &&
      !container.onGatewayNetwork,
  )
  if (orphanRoutes.length > 0) {
    results.push(
      check(
        'routes-off-network',
        'fail',
        'Routed services off the shared network',
        orphanRoutes.map((container) => container.name).join(', '),
        `attach them to the ${config.network} network; see docs/adopting-projects.md`,
      ),
    )
  } else {
    results.push(check('routes-off-network', 'pass', 'Routed services', 'every routed service is on the shared network'))
  }

  // Two containers claiming the same hostname: Traefik keeps one router and
  // silently drops the other.
  const byHost = new Map<string, string[]>()
  for (const container of snapshot.containers) {
    if (container.state !== 'running') continue
    for (const url of container.urls) {
      const list = byHost.get(url.host)
      if (list) list.push(container.name)
      else byHost.set(url.host, [container.name])
    }
  }
  const duplicates = [...byHost.entries()].filter(([, names]) => names.length > 1)
  if (duplicates.length > 0) {
    results.push(
      check(
        'hostname-collision',
        'fail',
        'Hostname collisions',
        duplicates.map(([host, names]) => `${host} (${names.join(', ')})`).join('; '),
        'give the projects distinct COMPOSE_PROJECT_NAMEs: dev-gateway namespace',
      ),
    )
  } else {
    results.push(check('hostname-collision', 'pass', 'Hostnames', 'no collisions'))
  }

  const conflicts = snapshot.ports.filter((usage) => usage.conflict)
  if (conflicts.length > 0) {
    results.push(
      check(
        'port-conflict',
        'warn',
        'Published port conflicts',
        conflicts.map((usage) => `${usage.hostPort}/${usage.protocol}`).join(', '),
        'stop one of the containers, or move it off the port',
      ),
    )
  } else {
    results.push(check('port-conflict', 'pass', 'Published ports', 'no port is claimed twice'))
  }

  // Somebody else on 80/443 means the gateway will not come back after a
  // restart, and the error only shows up then.
  const gatewayPorts = new Set([Number(config.httpPort), Number(config.httpsPort)])
  const squatters = snapshot.ports.filter(
    (usage) =>
      gatewayPorts.has(usage.hostPort) &&
      usage.bindings.some((binding) => binding.ownership !== 'gateway'),
  )
  if (squatters.length > 0) {
    results.push(
      check(
        'gateway-ports',
        'warn',
        'Gateway ports taken by other containers',
        squatters
          .map((usage) => `${usage.hostPort}: ${usage.bindings.map((b) => b.containerName).join(', ')}`)
          .join('; '),
        'stop the container, or change DEV_GATEWAY_HTTP_PORT / DEV_GATEWAY_HTTPS_PORT',
      ),
    )
  }

  const unhealthy = snapshot.containers.filter(
    (container) => container.state === 'running' && container.health === 'unhealthy',
  )
  if (unhealthy.length > 0) {
    results.push(
      check(
        'unhealthy',
        'warn',
        'Unhealthy containers',
        unhealthy.map((container) => container.name).join(', '),
        'open the container logs',
      ),
    )
  } else {
    results.push(check('unhealthy', 'pass', 'Container health', 'nothing is unhealthy'))
  }

  const now = snapshot.at
  const staleBridges = snapshot.containers.filter((container) => {
    if (container.gatewayComponent !== 'access-bridge') return false
    if (container.state !== 'running') return true
    const expires = Number(container.labels['dev-gateway.access.expires'] ?? '')
    return Number.isFinite(expires) && expires > 0 && expires < now
  })
  if (staleBridges.length > 0) {
    results.push(
      check(
        'stale-bridges',
        'warn',
        'Stale access bridges',
        `${staleBridges.length} bridge(s) expired or stopped`,
        'dev-gateway access gc',
      ),
    )
  }

  if (config.profile === 'remote-public' && config.publicEnabled) {
    results.push(
      check(
        'public',
        'warn',
        'Public access',
        `HTTP services are reachable on ${config.publicDomain ?? config.domain}`,
        'dev-gateway public disable turns this off',
      ),
    )
  }

  results.push(...panelChecks(config))

  if (config.tlsEnabled && config.tlsMode === 'acme' && !config.acmeEmailSet) {
    results.push(
      check('acme-email', 'fail', 'ACME', 'TLS_MODE=acme without ACME_EMAIL', 'set ACME_EMAIL in Settings'),
    )
  }

  if (config.profile === 'remote-private' && !config.tailscaleEnabled && config.bindAddress === '0.0.0.0') {
    results.push(
      check(
        'bind-address',
        'fail',
        'Bind address',
        'the private profile is bound to every interface',
        'set DEV_GATEWAY_BIND_ADDRESS to the VPN address, or enable Tailscale',
      ),
    )
  }

  return results
}

/**
 * The panel's own front door. A routed panel can stop containers and, since
 * ADR 0010, says what is being worked on, so this fails rather than warns:
 * the same precedent `doctor` already applies to a non-loopback dashboard.
 */
function panelChecks(config: PanelConfig): Diagnostic[] {
  const results: Diagnostic[] = []

  if (!isRouted(config)) {
    results.push(
      check('panel-auth', 'pass', 'Panel exposure', 'reachable on loopback only, where a password adds nothing'),
    )
    return results
  }

  if (!isAuthenticated(config)) {
    results.push(
      check(
        'panel-auth',
        'fail',
        'Panel authentication',
        `the panel is routed (expose: ${config.webExpose}) with no credential in front of it`,
        'dev-gateway web auth set',
      ),
    )
  } else {
    results.push(
      check('panel-auth', 'pass', 'Panel authentication', `Traefik BasicAuth as ${config.webAuthUser}`),
    )
  }

  if (!config.readOnly) {
    results.push(
      check(
        'panel-read-only',
        'warn',
        'Panel is routed and writable',
        'anyone who gets past the credential can stop and remove containers',
        'dev-gateway web up --read-only',
      ),
    )
  }

  // A middleware Traefik cannot resolve makes the router fail closed, so this
  // is about a locked-out user rather than an open panel.
  const wanted = renderPanelAuth(
    isAuthenticated(config) ? { user: config.webAuthUser, hash: config.webAuthHash } : null,
  )
  if (readGenerated(config.dynamicDir, GENERATED_FILES.panel) !== wanted) {
    results.push(
      check(
        'panel-auth-file',
        'warn',
        'Panel middleware is out of step',
        `${GENERATED_FILES.panel} does not match the current settings` +
          (isDirWritable(config.dynamicDir) ? '' : ', and the directory is not writable by the panel'),
        'dev-gateway web auth apply',
      ),
    )
  }

  return results
}

export function problemsOnly(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.status !== 'pass')
}
