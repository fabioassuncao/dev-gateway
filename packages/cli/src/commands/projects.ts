import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { branchSuffix, composeNamespace, parseEnv, projectsFor } from '@dev-gateway/core'
import type { Command } from 'commander'
import { z } from 'zod'
import { confirm } from '../confirm.js'
import { gatewayContext } from '../context.js'
import { inspectContainers } from '../docker.js'
import { RefusedError, UsageError } from '../errors.js'
import { Output } from '../output.js'
import { runProcess } from '../process.js'

function globals(command: Command) {
  return command.optsWithGlobals() as { json?: boolean; yes?: boolean; quiet?: boolean; verbose?: boolean; profile?: string }
}

export async function projectList(options: { project?: string }, command: Command): Promise<void> {
  const global = globals(command)
  const context = gatewayContext({ profile: global.profile })
  const projects = projectsFor(await inspectContainers(), context.config.domain, context.config.tlsEnabled ? 'https' : 'http').filter((project) => !options.project || project.name === options.project)
  const output = new Output(global)
  if (output.json) output.data({ instance: { name: context.config.projectName }, projects: projects.map((project) => ({ name: project.name, state: project.state, serviceCount: project.services.length, urls: project.urls })) })
  else for (const project of projects) output.line(`${project.name}\t${project.state}\t${project.services.length} services\t${project.urls.length} urls`)
}

export async function projectShow(name: string, command: Command): Promise<void> {
  const global = globals(command)
  const context = gatewayContext({ profile: global.profile })
  const project = projectsFor(await inspectContainers(), context.config.domain, context.config.tlsEnabled ? 'https' : 'http').find((candidate) => candidate.name === name)
  if (!project) throw new UsageError(`project not found: ${name}`)
  const output = new Output(global)
  const value = {
    instance: { name: context.config.projectName }, name: project.name, state: project.state,
    services: project.services.map((service) => ({ name: service.labels['com.docker.compose.service'] ?? service.name, container: service.name, image: service.image, state: service.state, ports: service.ports, networks: service.networks })),
    urls: project.urls,
  }
  if (output.json) output.data(value)
  else {
    output.line(`${project.name} · ${project.state}`)
    for (const service of value.services) output.line(`${service.name}\t${service.state}\t${service.image}`)
    for (const url of value.urls) output.line(url.url)
  }
}

function classify(image: string, name: string): string {
  const value = `${image} ${name}`.toLowerCase()
  if (/postgres|mysql|mariadb|mongo/.test(value)) return 'database'
  if (/redis|valkey|memcached/.test(value)) return 'cache'
  if (/rabbitmq|kafka|nats/.test(value)) return 'queue'
  return 'application'
}

export async function servicesCommand(options: { project?: string }, command: Command): Promise<void> {
  const global = globals(command)
  const context = gatewayContext({ profile: global.profile })
  const services = (await inspectContainers()).filter((container) => container.labels['com.docker.compose.project'] && (!options.project || container.labels['com.docker.compose.project'] === options.project)).map((container) => ({
    project: container.labels['com.docker.compose.project']!,
    service: container.labels['com.docker.compose.service'] ?? container.name,
    container: container.name,
    state: container.state,
    kind: classify(container.image, container.name),
    ports: container.ports,
    networks: container.networks,
    routed: container.labels['traefik.enable'] === 'true',
  })).sort((a, b) => `${a.project}/${a.service}`.localeCompare(`${b.project}/${b.service}`))
  const output = new Output(global)
  if (output.json) output.data({ instance: { name: context.config.projectName }, services })
  else for (const service of services) output.line(`${service.project}\t${service.service}\t${service.kind}\t${service.state}`)
}

const ComposePort = z.union([z.string(), z.number(), z.object({ target: z.union([z.string(), z.number()]).optional(), published: z.union([z.string(), z.number()]).optional() }).passthrough()])
const ComposeService = z.object({
  image: z.string().optional(), ports: z.array(ComposePort).optional(), container_name: z.string().optional(),
  expose: z.array(z.union([z.string(), z.number()])).optional(), networks: z.union([z.array(z.string()), z.record(z.string(), z.unknown())]).optional(),
  volumes: z.array(z.union([z.string(), z.object({ source: z.string().optional(), target: z.string().optional() }).passthrough()])).optional(),
  labels: z.union([z.array(z.string()), z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))]).optional(),
}).passthrough()
const ComposeSchema = z.object({ name: z.string().optional(), services: z.record(z.string(), ComposeService) }).passthrough()
type ComposeService = z.infer<typeof ComposeService>

const DATASTORE = /postgres|postgis|timescale|mysql|mariadb|percona|redis|valkey|keydb|mongo|memcached|elasticsearch|opensearch|rabbitmq|kafka|clickhouse|cassandra|neo4j|minio|rustfs|mailpit|mailhog/i
const HTTP_IMAGE = /nginx|httpd|apache|caddy|traefik|node|php|python|ruby|golang|openresty|haproxy|whoami|frankenphp/i
const WORKER_NAME = /(^|[-_])(worker|queue|scheduler|cron|consumer|beat|migrator|migrate|init|seed|setup)([-_]|$)/i
const HTTP_NAME = /(^|[-_])(web|app|api|frontend|backend|site|www|http|nginx|server|ui|admin|dashboard|gateway)([-_]|$)/i

function classifyCompose(image: string, name: string): 'datastore' | 'http' | 'worker' | 'unknown' {
  if (DATASTORE.test(image)) return 'datastore'
  if (HTTP_IMAGE.test(image)) return 'http'
  if (WORKER_NAME.test(name)) return 'worker'
  if (HTTP_NAME.test(name)) return 'http'
  return 'unknown'
}

function publishedPorts(service: ComposeService): Array<{ host: string; container: string }> {
  return (service.ports ?? []).flatMap((port) => {
    if (typeof port === 'object' && port.published !== undefined) return [{ host: String(port.published), container: String(port.target ?? '') }]
    if (typeof port === 'string') {
      const match = /^(?:[^:]+:)?(\d+):(\d+)(?:\/\w+)?$/.exec(port)
      return match ? [{ host: match[1]!, container: match[2]! }] : []
    }
    return []
  })
}

function containerPorts(service: ComposeService): string[] {
  const ports = (service.ports ?? []).flatMap((port) => {
    if (typeof port === 'object' && port.target !== undefined) return [String(port.target)]
    if (typeof port === 'number') return [String(port)]
    const match = /(?:^|:)(\d+)(?:\/\w+)?$/.exec(String(port)); return match ? [match[1]!] : []
  })
  return [...new Set(ports)]
}

function labelsOf(service: ComposeService): Record<string, string> {
  if (Array.isArray(service.labels)) return Object.fromEntries(service.labels.map((label) => { const at = label.indexOf('='); return [label.slice(0, at), label.slice(at + 1)] }))
  return Object.fromEntries(Object.entries(service.labels ?? {}).map(([key, value]) => [key, String(value)]))
}

function composeCandidates(path: string): string[] {
  return ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'].map((file) => join(path, file)).filter(existsSync)
}

async function analyze(pathValue: string) {
  const path = resolve(pathValue)
  const candidates = composeCandidates(path)
  if (!candidates[0]) throw new UsageError(`no Compose file found in ${path}`)
  let result = await runProcess('docker', ['compose', '-f', candidates[0], 'config', '--format', 'json'], { cwd: path, reject: false })
  if (result.exitCode !== 0) result = await runProcess('docker', ['compose', '-f', candidates[0], 'config', '--format', 'json', '--no-interpolate'], { cwd: path })
  const model = ComposeSchema.parse(JSON.parse(result.stdout))
  const overlay = ['compose.dev-gateway.yaml', 'compose.dev-gateway.yml'].find((file) => existsSync(join(path, file))) ?? null
  const projectFromEnv = existsSync(join(path, '.env')) ? parseEnv(readFileSync(join(path, '.env'), 'utf8')).get('COMPOSE_PROJECT_NAME') : undefined
  const project = projectFromEnv || composeNamespace(model.name ?? basename(path))
  const services = Object.entries(model.services).map(([name, service]) => ({
    name,
    image: service.image ?? null,
    kind: classifyCompose(service.image ?? '', name),
    container_name: service.container_name ?? null,
    published_ports: publishedPorts(service),
    container_ports: containerPorts(service),
    expose: (service.expose ?? []).map(String),
    networks: Array.isArray(service.networks) ? service.networks : Object.keys(service.networks ?? {}),
    volumes: (service.volumes ?? []).map((volume) => typeof volume === 'string' ? volume.split(':')[0]! : volume.source ?? volume.target ?? ''),
    labels: labelsOf(service),
  }))
  return {
    path, compose_file: basename(candidates[0]), gateway_overlay: overlay,
    project: { name: project, source: projectFromEnv ? '.env' : 'directory name (implicit)' },
    domain: gatewayContext({ required: false }).config.domain, services,
    findings: {
      published_host_ports: services.filter((service) => service.published_ports.length > 0).map((service) => service.name),
      fixed_container_names: services.filter((service) => service.container_name).map((service) => service.name),
      published_datastores: services.filter((service) => service.kind === 'datastore' && service.published_ports.length > 0).map((service) => service.name),
      implicit_namespace: !projectFromEnv,
      already_adopted: overlay !== null,
    },
  }
}

export async function analyzeCommand(path: string, command: Command): Promise<void> {
  const report = await analyze(path)
  const output = new Output(globals(command))
  if (output.json) output.data(report)
  else {
    output.line(`Project: ${basename(report.path)}`)
    output.line(`  path                   ${report.path}`)
    output.line(`  compose file           ${report.compose_file}`)
    output.line(`  gateway overlay        ${report.gateway_overlay ?? 'none'}`)
    output.line(`  project namespace      ${report.project.name} (${report.project.source})`)
    const identities = [...new Set(report.services.flatMap((service) => Object.entries(service.labels).filter(([key]) => key.startsWith('dev-gateway.project') || key.startsWith('dev-gateway.repo') || key.startsWith('dev-gateway.git.root')).map(([key, value]) => `${key}=${value}`)))]
    output.line(`  declared identity      ${identities.length ? identities.join(' ') : 'none (inferred from the Compose labels)'}`)
    output.line('\nServices')
    for (const service of report.services) output.line(`  ${service.name}\t${service.image ?? '<built>'}\t${service.kind}\t${service.published_ports.map((port) => `${port.host}:${port.container}`).join(',') || '-'}`)
    output.line('\nFindings')
    const containers = await inspectContainers()
    if (report.findings.published_host_ports.length) {
      output.line('\n  Published host ports')
      for (const service of report.services) for (const port of service.published_ports) {
        const holder = containers.find((container) => container.ports.some((binding) => binding.publicPort === Number(port.host)))
        output.line(`    ${service.name}\t${port.host} -> ${port.container}${holder ? `  already held by ${holder.name}` : ''}`)
      }
    } else output.line('\n  No published host ports, so nothing can collide.')
    if (report.findings.fixed_container_names.length) output.line(`\n  Fixed container names\n    ${report.findings.fixed_container_names.join(', ')}`)
    if (report.findings.published_datastores.length) output.line(`\n  Datastores published on the host\n    ${report.findings.published_datastores.join(', ')}`)
    if (report.findings.implicit_namespace) output.line('\n  Namespace is implicit\n    COMPOSE_PROJECT_NAME is not set, so Compose uses the directory name')
    output.line('\nAdoption plan')
    if (report.gateway_overlay) output.line(`  This project already has ${report.gateway_overlay}.`)
    else for (const service of report.services.filter((service) => service.kind === 'http')) output.line(`  ${service.name}\tport ${service.container_ports[0] ?? service.expose[0] ?? '?'} -> http://${report.project.name}-${service.name}.${report.domain}`)
    output.line('\nNothing in this project was modified. See docs/adopting-projects.md.')
  }
}

function renderOverlay(project: string, services: Array<{ name: string; port: number }>, network: string, domain: string): string {
  const blocks = services.map(({ name, port }) => `  ${name}:\n    networks:\n      - default\n      - dev-gateway\n    labels:\n      - "traefik.enable=true"\n      - "traefik.docker.network=\${DEV_GATEWAY_NETWORK:-${network}}"\n      - "traefik.http.services.\${COMPOSE_PROJECT_NAME:-${project}}-${name}.loadbalancer.server.port=${port}"`).join('\n\n')
  return `# ============================================================================\n# Dev Gateway integration\n# ============================================================================\n# Generated by \`dev-gateway init\`. This file is yours: edit it freely.\n# Hostnames follow <COMPOSE_PROJECT_NAME>-<service>.${domain}.\n# Databases and caches remain only on the project's private network.\n# ============================================================================\n\nservices:\n${blocks}\n\nnetworks:\n  dev-gateway:\n    external: true\n    name: \${DEV_GATEWAY_NETWORK:-${network}}\n`
}

export async function initCommand(pathValue: string, options: { dryRun?: boolean; service?: string[]; output?: string; force?: boolean }, command: Command): Promise<void> {
  const report = await analyze(pathValue)
  const context = gatewayContext({ required: false })
  const requested = options.service?.map((entry) => {
    const match = /^([a-zA-Z0-9_.-]+):(\d+)$/.exec(entry)
    if (!match) throw new UsageError(`invalid --service value: ${entry}; expected name:port`)
    if (!report.services.some((service) => service.name === match[1])) throw new UsageError(`no service named ${match[1]} in ${report.compose_file}`)
    return { name: match[1]!, port: Number(match[2]) }
  }) ?? report.services.filter((service) => service.kind === 'http').map((service) => ({ name: service.name, port: Number(service.container_ports[0] ?? service.expose[0] ?? 80) }))
  if (!requested.length) throw new RefusedError('no HTTP service was detected', 'pass --service name:port explicitly')
  const content = renderOverlay(report.project.name, requested, context.config.network, context.config.domain)
  const destination = resolve(report.path, options.output ?? 'compose.dev-gateway.yaml')
  const output = new Output(globals(command))
  if (options.dryRun) { output.data(content); return }
  if (existsSync(destination) && !options.force) throw new RefusedError(`${destination} already exists`, 'pass --force to replace it while keeping a backup')
  await confirm(`write ${destination}?`, globals(command).yes === true)
  if (existsSync(destination)) renameSync(destination, `${destination}.bak.${Date.now()}`)
  writeFileSync(destination, content, { mode: 0o644 })
  output.progress(`created  ${destination}`)
}

async function gitOutput(path: string, args: string[]): Promise<string | null> {
  const result = await runProcess('git', ['-C', path, ...args], { reject: false })
  return result.exitCode === 0 ? result.stdout.trim() : null
}

export async function namespaceCommand(options: { path?: string; base?: string; suffix?: string; check?: boolean }, command: Command): Promise<void> {
  const path = resolve(options.path ?? process.cwd())
  const root = await gitOutput(path, ['rev-parse', '--show-toplevel'])
  const branch = await gitOutput(path, ['branch', '--show-current'])
  const base = options.base ?? basename(root ?? path).replace(/-(worktree|wt)$/i, '')
  const suffix = options.suffix ?? (branch ? branchSuffix(branch) : null)
  const namespace = composeNamespace(base, suffix)
  if (options.check !== false) {
    const collision = (await inspectContainers()).some((container) => container.labels['com.docker.compose.project'] === namespace)
    if (collision) throw new RefusedError(`Compose project ${namespace} is already running`, 'pass --no-check only when sharing it is intentional')
  }
  const output = new Output(globals(command))
  if (output.json) output.data({ namespace, base: composeNamespace(base), suffix })
  else output.data(namespace)
}
