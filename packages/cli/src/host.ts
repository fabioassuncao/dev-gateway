// What this machine is, as opposed to what Portta has been told to be.
//
// Everything here is an observation of the host: its addresses, whether a tool
// is on PATH, how a file is permissioned. It never changes anything. The
// verdicts drawn from these facts are pure and live in portta-core; keeping the
// probes out here is what lets those verdicts be tested without a host.
//
// The shell equivalents are `portta_private_addresses`, `portta_ip_is_private`,
// `portta_locate`, `portta_detect_public_ip` and `portta_file_mode` in
// scripts/lib/common.sh, which survive only for the zero-Node fallback
// (ADR 0015).

import { homedir, loadavg, networkInterfaces, uptime } from 'node:os'
import { accessSync, constants, existsSync, globSync, readFileSync, statfsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  cpuUtilisation,
  mergeStorage,
  parseCpuinfo,
  parseLoadavg,
  parseMeminfo,
  parseNvidiaSmi,
  parseProcStat,
  parseSysctlBoottime,
  parseUptime,
  type CollectedHost,
  type CollectedStorage,
} from 'portta-core'
import { runProcess } from './process.js'

/**
 * Tailscale's CGNAT range. A tailnet address is reported under its own
 * capability; listing it as a LAN address as well would offer one network
 * twice under two names, and would let `auto-domain` claim the internet can
 * reach a host it cannot.
 */
function isTailscaleRange(address: string): boolean {
  const [a, b] = address.split('.').map(Number)
  return a === 100 && b !== undefined && b >= 64 && b <= 127
}

/** RFC 1918, plus loopback, link-local and the CGNAT range. */
export function isPrivateAddress(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a, b] = parts as [number, number, number, number]
  if (a === 10 || a === 127) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  return isTailscaleRange(address)
}

/**
 * Interfaces Portta must not offer as a way to reach this host. Docker's own
 * bridges are the reason this filters by interface name and not only by
 * address: a host running Docker has one 172.x gateway per network, and
 * `web.172-18-0-1.sslip.io` is pure noise.
 */
const IGNORED_INTERFACES = /^(docker|br-|veth|virbr|tailscale|lo$|utun|awdl|llw|bridge|vnic)/

/** This host's own non-loopback private addresses, tailnet excluded. */
export function privateAddresses(): string[] {
  const found: string[] = []
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    if (IGNORED_INTERFACES.test(name)) continue
    for (const entry of addresses ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue
      if (!isPrivateAddress(entry.address) || isTailscaleRange(entry.address)) continue
      if (entry.address.startsWith('127.')) continue
      found.push(entry.address)
    }
  }
  return [...new Set(found)]
}

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * Where an executable is, looking beyond this process's PATH.
 *
 * A developer's toolchain is usually wired into an interactive shell — nvm in
 * .zshrc, agent CLIs symlinked into ~/.local/bin — and a non-interactive
 * process sees none of it. Reporting "not found" for a tool the machine
 * plainly has is worse than saying nothing, so these are the places worth
 * looking before giving that answer. Mirrors `portta_locate`.
 */
export async function locate(tool: string): Promise<string | null> {
  const onPath = await runProcess('which', [tool], { reject: false })
  const direct = onPath.stdout.trim().split('\n')[0]
  if (!onPath.failed && direct) return direct

  const home = homedir()
  for (const candidate of [
    join(home, '.local/bin', tool),
    join(home, '.bun/bin', tool),
    join(home, '.cargo/bin', tool),
    join(home, '.deno/bin', tool),
    join('/usr/local/bin', tool),
    join('/opt/homebrew/bin', tool),
    join(home, '.volta/bin', tool),
  ]) {
    if (executable(candidate)) return candidate
  }

  // nvm and fnm keep one directory per installed version.
  for (const pattern of [
    join(home, '.nvm/versions/node/*/bin', tool),
    join(home, '.local/share/fnm/node-versions/*/installation/bin', tool),
  ]) {
    for (const match of globSync(pattern)) if (executable(match)) return match
  }
  return null
}

/** Whether a tool is reachable at all, by path or on PATH. */
export async function have(tool: string): Promise<boolean> {
  return (await locate(tool)) !== null
}

/**
 * The permission bits in octal, or null when the file cannot be read.
 *
 * Unpadded, the way `stat -c %a` and `stat -f %Lp` report them, because that
 * is the spelling every message, comparison and document in the tree already
 * uses: `chmod 600`, "mode 600", "would change .env from 644 to 600".
 */
export function fileMode(path: string): string | null {
  try {
    return (statSync(path).mode & 0o7777).toString(8)
  } catch {
    return null
  }
}

/**
 * This host's address as the internet sees it.
 *
 * One outbound request, and only when the caller asks for it: a diagnostic
 * that phones a third party on every run is a diagnostic people turn off.
 */
const PUBLIC_IP_SERVICES = ['https://api.ipify.org', 'https://ifconfig.me/ip', 'https://icanhazip.com']

export async function detectPublicIp(timeoutMs = 5000): Promise<string | null> {
  for (const url of PUBLIC_IP_SERVICES) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) continue
      const address = (await response.text()).trim()
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) return address
    } catch {
      // Try the next service; a diagnostic that fails because one host is down
      // has told the reader nothing about their own machine.
    } finally {
      clearTimeout(timer)
    }
  }
  return null
}

function readText(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : null
  } catch {
    return null
  }
}

async function sysctl(name: string): Promise<string | null> {
  const result = await runProcess('sysctl', ['-n', name], { reject: false, timeout: 2000 })
  return result.failed ? null : result.stdout.trim() || null
}

function filesystemOf(path: string): CollectedStorage | null {
  try {
    const stats = statfsSync(path)
    const totalBytes = Number(stats.blocks) * Number(stats.bsize)
    const availableBytes = Number(stats.bavail) * Number(stats.bsize)
    if (totalBytes <= 0) return null
    return {
      path,
      role: 'portta',
      totalBytes,
      usedBytes: Math.max(0, totalBytes - availableBytes),
      availableBytes,
    }
  } catch {
    return null
  }
}

function deviceOf(path: string): number | null {
  try {
    return statSync(path).dev
  } catch {
    return null
  }
}

async function dockerRootDir(): Promise<string | null> {
  const result = await runProcess('docker', ['info', '--format', '{{.DockerRootDir}}'], {
    reject: false,
    timeout: 5000,
  })
  const path = result.failed ? '' : result.stdout.trim()
  return path === '' ? null : path
}

async function cpuModel(): Promise<string | null> {
  return parseCpuinfo(readText('/proc/cpuinfo') ?? '') ?? (await sysctl('machdep.cpu.brand_string'))
}

async function hostUptimeSeconds(): Promise<number | null> {
  const proc = parseUptime(readText('/proc/uptime') ?? '')
  if (proc !== null) return proc
  const boot = await sysctl('kern.boottime')
  if (boot) {
    const parsed = parseSysctlBoottime(boot, Math.floor(Date.now() / 1000))
    if (parsed !== null) return parsed
  }
  const seconds = uptime()
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null
}

function hostLoad(): ReturnType<typeof parseLoadavg> {
  return parseLoadavg(readText('/proc/loadavg') ?? '') ?? (() => {
    const [one, five, fifteen] = loadavg()
    if ([one, five, fifteen].some((value) => !Number.isFinite(value))) return null
    return { one, five, fifteen }
  })()
}

async function cpuBusyShare(): Promise<number | null> {
  const firstText = readText('/proc/stat')
  if (firstText === null) return null
  const first = parseProcStat(firstText)
  if (first === null) return null
  await new Promise((resolve) => setTimeout(resolve, 1000))
  const second = parseProcStat(readText('/proc/stat') ?? '')
  if (second === null) return null
  return cpuUtilisation(first, second)
}

async function nvidiaGpus(): Promise<CollectedHost['gpu']> {
  const tool = await locate('nvidia-smi')
  if (!tool) return []
  const result = await runProcess(
    tool,
    ['--query-gpu=name,memory.total,memory.used,utilization.gpu', '--format=csv,noheader,nounits'],
    { reject: false, timeout: 3000 },
  )
  if (result.failed) return []
  return parseNvidiaSmi(result.stdout)
}

/**
 * What this host looks like right now, as one snapshot for `state/host/host.json`.
 *
 * Runs on the host. `/proc` and `os.*` here describe the machine, not a
 * container. A missing probe is a missing field, never a thrown error.
 */
export async function collectHostSnapshot(root: string, now = Date.now()): Promise<CollectedHost> {
  const dockerDir = await dockerRootDir()
  const dockerFs = dockerDir ? filesystemOf(dockerDir) : null
  if (dockerFs) dockerFs.role = 'docker'
  const porttaFs = filesystemOf(root)
  const sameDevice =
    dockerDir !== null && deviceOf(dockerDir) !== null && deviceOf(dockerDir) === deviceOf(root)

  return {
    collectedAt: Math.floor(now / 1000),
    uptimeSeconds: await hostUptimeSeconds(),
    load: hostLoad(),
    cpu: {
      model: await cpuModel(),
      utilisation: await cpuBusyShare(),
    },
    memory: parseMeminfo(readText('/proc/meminfo') ?? ''),
    storage: mergeStorage(dockerFs, porttaFs, sameDevice),
    gpu: await nvidiaGpus(),
  }
}
