// `portta backup`, `portta restore`, `portta repair`.
//
// The three operations that assume something has gone wrong, or is about to.
//
// What has to be preserved is decided by ADR 0020: everything under
// PORTTA_HOME is a bind mount and can simply be copied, **except** the panel's
// PostgreSQL data, which lives in a named volume and has to be dumped by the
// database itself. A backup that copied the volume's files while Postgres was
// running would be a torn one, so it never does that.

import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Command } from 'commander'
import { isTrue } from 'portta-core'
import { composeArguments, gatewayContext, type GatewayContext } from '../context.js'
import { PreconditionError, UsageError } from '../errors.js'
import { Output } from '../output.js'
import { runProcess } from '../process.js'
import { fileMode } from '../host.js'

function globals(command: Command) { return command.optsWithGlobals() as { json?: boolean; yes?: boolean; quiet?: boolean; verbose?: boolean; profile?: string } }

/**
 * The archive format. An archive written by an older Portta must restore under
 * a newer one, so this changes only when the layout does — and a change means
 * a reader for the old shape, never a refusal.
 */
export const BACKUP_VERSION = 1

export interface BackupManifest {
  version: number
  portta: string
  created: string
  host: string
}

/**
 * What a backup contains, and deliberately not everything.
 *
 * Anything the installer can fetch again (`bin`, `scripts`, `docker/`) is left
 * out: including it would make the archive a stale copy of the release, and
 * restoring it onto a newer Portta would quietly downgrade the code while
 * claiming to restore data.
 */
export function backupPaths(root: string): string[] {
  return ['.env', 'VERSION', 'config', 'state'].filter((path) => existsSync(join(root, path)))
}

export function renderManifest(manifest: BackupManifest): string {
  return `${JSON.stringify(manifest)}\n`
}

export function parseManifest(text: string): BackupManifest | null {
  try {
    const parsed = JSON.parse(text) as Partial<BackupManifest>
    if (typeof parsed.version !== 'number') return null
    return { version: parsed.version, portta: parsed.portta ?? 'unknown', created: parsed.created ?? '', host: parsed.host ?? '' }
  } catch {
    return null
  }
}

function dbContainer(env: Record<string, string | undefined>): string {
  return `${env['PORTTA_PROJECT_NAME'] || 'portta'}-db-1`
}

async function containerRunning(name: string): Promise<boolean> {
  const result = await runProcess('docker', ['inspect', '-f', '{{.State.Running}}', name], { reject: false })
  return !result.failed && result.stdout.trim() === 'true'
}

/**
 * A dump taken by PostgreSQL itself.
 *
 * Copying the volume's files under a running server would produce a torn
 * snapshot; `pg_dump` produces a consistent one and restores into any later
 * PostgreSQL, which is what makes an upgrade survivable.
 */
async function dumpDatabase(context: GatewayContext, target: string): Promise<boolean> {
  const container = dbContainer(context.env)
  if (!(await containerRunning(container))) return false
  const dump = await runProcess('docker', ['exec', container, 'pg_dump', '-U', 'portta', '-d', 'portta', '--clean', '--if-exists'], { reject: false })
  if (dump.failed || !dump.stdout) return false
  writeFileSync(target, dump.stdout, { mode: 0o600 })
  return true
}

export async function backupCommand(options: { output?: string; database?: boolean }, command: Command): Promise<void> {
  const global = globals(command)
  const output = new Output(global)
  const context = gatewayContext({ profile: global.profile })

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  const target = options.output ?? join(context.root, `portta-backup-${stamp}.tar.gz`)

  // The staging area holds a copy of every secret in the installation.
  const staging = mkdtempSync(join(tmpdir(), 'portta-backup-'))
  chmodSync(staging, 0o700)
  try {
    writeFileSync(join(staging, 'portta-backup.json'), renderManifest({
      version: BACKUP_VERSION,
      portta: context.version,
      created: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      host: hostname() || 'unknown',
    }))

    const paths = backupPaths(context.root)
    for (const path of paths) {
      mkdirSync(join(staging, 'tree', dirname(path)), { recursive: true })
      cpSync(join(context.root, path), join(staging, 'tree', path), { recursive: true })
    }

    let database = false
    if (options.database !== false) {
      database = await dumpDatabase(context, join(staging, 'database.sql'))
      if (!database) {
        output.warning('the panel database was not included')
        output.hint('it is only there when the panel is running; --no-database silences this')
      }
    }

    // A backup is a file full of credentials, so it is created with a private
    // umask rather than chmod'ed afterwards: it is never briefly world-readable.
    const previous = process.umask(0o077)
    let archived
    try {
      archived = await runProcess('tar', ['-czf', target, '-C', staging, '.'], { reject: false })
    } finally {
      process.umask(previous)
    }
    if (archived.failed) throw new PreconditionError(`could not write ${target}`, archived.stderr.trim())

    const size = statSync(target).size
    if (output.json) { output.data({ file: target, size, paths, database }); return }
    output.progress('backup written')
    output.line(`  file      ${target}`)
    output.line(`  size      ${humanSize(size)}`)
    output.line(`  contents  ${paths.length} path(s)${database ? ' + database' : ''}`)
    output.line('')
    output.warning('this archive contains credentials: .env, the panel password hash and any tokens')
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

export function humanSize(bytes: number): string {
  const units = ['B', 'K', 'M', 'G', 'T']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1 }
  return `${unit === 0 ? value : value.toFixed(1)}${units[unit]}`
}

export async function restoreCommand(archive: string | undefined, options: { force?: boolean }, command: Command): Promise<void> {
  const global = globals(command)
  const output = new Output(global)
  const context = gatewayContext({ profile: global.profile })

  if (!archive) throw new UsageError('which backup?', 'portta restore <file>')
  if (!existsSync(archive)) throw new UsageError(`no such file: ${archive}`)

  const staging = mkdtempSync(join(tmpdir(), 'portta-restore-'))
  chmodSync(staging, 0o700)
  try {
    const extracted = await runProcess('tar', ['-xzf', archive, '-C', staging], { reject: false })
    if (extracted.failed) throw new UsageError('that file is not a Portta backup')

    const manifestPath = join(staging, 'portta-backup.json')
    if (!existsSync(manifestPath)) throw new UsageError('that archive has no Portta manifest')
    const manifest = parseManifest(readFileSync(manifestPath, 'utf8'))
    if (!manifest) throw new UsageError('that archive has an unreadable Portta manifest')
    output.progress(`restoring a backup taken from Portta ${manifest.portta}`)

    // Refusing by default matters: restoring over a running installation
    // replaces its credentials, and the containers would keep running with the
    // old ones.
    if (!options.force && await containerRunning(`${context.env['PORTTA_PROJECT_NAME'] || 'portta'}-traefik-1`)) {
      throw new PreconditionError('the gateway is running',
        'portta down, then restore; or pass --force to replace configuration underneath it')
    }

    // Whatever is being replaced is kept, because a restore that turns out to
    // be the wrong archive is otherwise unrecoverable.
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
    const safety = join(context.root, 'state', `restore-${stamp}`)
    mkdirSync(safety, { recursive: true })
    for (const path of ['.env', 'config']) {
      if (existsSync(join(context.root, path))) {
        cpSync(join(context.root, path), join(safety, path), { recursive: true })
      }
    }
    output.progress(`kept what was there under ${safety}`)

    const tree = join(staging, 'tree')
    if (existsSync(tree)) {
      for (const path of backupPaths(tree)) {
        cpSync(join(tree, path), join(context.root, path), { recursive: true, force: true })
      }
      output.progress('configuration and state restored')
    }
    if (existsSync(join(context.root, '.env'))) chmodSync(join(context.root, '.env'), 0o600)

    const dump = join(staging, 'database.sql')
    if (existsSync(dump)) {
      const container = dbContainer(context.env)
      const loaded = await containerRunning(container)
        ? await runProcess('docker', ['exec', '-i', container, 'psql', '-U', 'portta', '-d', 'portta', '-v', 'ON_ERROR_STOP=1', '-q'],
            { input: readFileSync(dump, 'utf8'), reject: false })
        : { failed: true }
      if (loaded.failed) {
        output.warning('the database dump was not loaded')
        output.hint(`start the gateway, then: portta restore ${archive} --force`)
      } else {
        output.progress('panel database restored')
      }
    }

    output.line('')
    output.progress('restore complete')
    output.hint('portta up   then   portta doctor')
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

/**
 * Directories the compose files bind-mount, with the mode each must end up
 * with. A missing one makes Docker create it as root, which then breaks the
 * panel writing to it. Created with the right mode, so the permission pass
 * never reports work this list just made for it.
 */
export const REPAIR_DIRECTORIES: Array<{ path: string; mode: number }> = [
  { path: 'config/traefik/dynamic', mode: 0o755 },
  { path: 'config/tls', mode: 0o755 },
  { path: 'state/traefik/acme', mode: 0o700 },
  { path: 'state/tailscale', mode: 0o755 },
  { path: 'state/access', mode: 0o755 },
  { path: 'state/git', mode: 0o755 },
  { path: 'state/github', mode: 0o755 },
  { path: 'state/host', mode: 0o755 },
  { path: 'state/runner', mode: 0o700 },
  { path: 'state/cloudflared', mode: 0o700 },
]

/** Things that hold secrets, and the mode that makes them not a finding. */
export const REPAIR_MODES: Array<{ path: string; mode: number }> = [
  { path: '.env', mode: 0o600 },
  { path: 'state/traefik/acme', mode: 0o700 },
  { path: 'state/traefik/acme/acme.json', mode: 0o600 },
  { path: 'state/cloudflared', mode: 0o700 },
  { path: 'state/cloudflared/credentials.json', mode: 0o600 },
  { path: 'state/runner', mode: 0o700 },
]

/**
 * Everything repair does is idempotent and additive. It never deletes data,
 * never touches a volume and never rewrites a value somebody chose: it
 * recreates what is missing and fixes what is provably wrong, which is the
 * difference between a repair and a reinstall.
 */
export async function repairCommand(options: { dryRun?: boolean }, command: Command): Promise<void> {
  const global = globals(command)
  const output = new Output(global)
  const context = gatewayContext({ profile: global.profile })
  const dry = options.dryRun ?? false
  const changes: string[] = []

  output.progress('Repair')

  for (const { path, mode } of REPAIR_DIRECTORIES) {
    const full = join(context.root, path)
    if (existsSync(full)) continue
    changes.push(`create ${path}`)
    if (dry) { output.line(`   would create ${path}`); continue }
    mkdirSync(full, { recursive: true })
    chmodSync(full, mode)
    output.progress(`created ${path}`)
  }

  for (const { path, mode } of REPAIR_MODES) {
    const full = join(context.root, path)
    if (!existsSync(full)) continue
    const have = fileMode(full)
    const want = mode.toString(8)
    if (!have || have === want) continue
    changes.push(`chmod ${path} ${want}`)
    if (dry) { output.line(`   would change ${path} from ${have} to ${want}`); continue }
    chmodSync(full, mode)
    output.progress(`${path} is now ${want} (was ${have})`)
  }

  // The shared network is external and outlives the stack, so a housekeeping
  // sweep on the host can remove it and nothing brings it back. The gateway
  // itself never prunes anything; tests/unit/audit.test.sh enforces that.
  const networks = [context.env['PORTTA_NETWORK'] || 'portta']
  // The access network carries TCP services and is absent by design when they
  // are off. Demanding it on every host would report a repair that is not one.
  if (isTrue(context.env['PORTTA_TCP'])) networks.push(context.env['PORTTA_ACCESS_NETWORK'] || 'portta-access')
  for (const network of networks) {
    const exists = await runProcess('docker', ['network', 'inspect', network], { reject: false })
    if (!exists.failed) continue
    changes.push(`create network ${network}`)
    if (dry) { output.line(`   would create network ${network}`); continue }
    const created = await runProcess('docker', ['network', 'create', '--label', 'portta.managed=true', network], { reject: false })
    if (created.failed) output.warning(`could not create network ${network}`)
    else output.progress(`created network ${network}`)
  }

  if (dry) {
    output.line('')
    if (output.json) { output.data({ dryRun: true, changes }); return }
    output.progress(changes.length === 0 ? 'nothing to repair' : `${changes.length} thing(s) would be repaired`)
    return
  }

  // `up -d` is idempotent: containers whose definition has not changed are
  // left alone, so this is safe to run on a healthy installation.
  output.progress('reconciling containers')
  const up = await runProcess('docker', ['compose', ...composeArguments(context), 'up', '-d', '--remove-orphans'],
    { cwd: context.root, env: context.env as NodeJS.ProcessEnv, stdio: 'inherit', reject: false })
  if (up.failed) throw new PreconditionError('the gateway did not come up', 'portta doctor')

  output.line('')
  if (output.json) { output.data({ dryRun: false, changes }); return }
  output.progress(changes.length === 0 ? 'nothing needed repairing; containers reconciled' : `${changes.length} thing(s) repaired; containers reconciled`)
  output.hint('portta doctor   confirms the result')
}
