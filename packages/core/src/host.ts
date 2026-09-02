// Pure parsers for the host collector. Every function takes a string the
// host already read and returns numbers, or null when the text is not that
// kind of file. Nothing here opens a path or runs a process: those belong
// in the CLI, so the same fixtures can be tested without a kernel.

export interface CollectedLoad {
  one: number
  five: number
  fifteen: number
}

export interface CollectedMemory {
  totalBytes: number
  availableBytes: number
  usedBytes: number
}

export interface CollectedStorage {
  path: string
  role: 'docker' | 'portta' | 'both'
  totalBytes: number
  usedBytes: number
  availableBytes: number
}

export interface CollectedGpu {
  name: string
  memoryTotalBytes: number
  memoryUsedBytes: number
  utilisation: number | null
}

export interface CollectedCpu {
  model: string | null
  utilisation: number | null
}

export interface CollectedHost {
  collectedAt: number
  uptimeSeconds: number | null
  load: CollectedLoad | null
  cpu: CollectedCpu
  memory: CollectedMemory | null
  storage: CollectedStorage[]
  gpu: CollectedGpu[]
}

export interface ProcStatSample {
  idle: number
  total: number
}

/** The aggregate `cpu` line of `/proc/stat`. */
export function parseProcStat(text: string): ProcStatSample | null {
  const line = text.split('\n').find((entry) => entry.startsWith('cpu '))
  if (!line) return null
  const fields = line.trim().split(/\s+/).slice(1).map(Number)
  if (fields.length < 4 || fields.some((value) => !Number.isFinite(value))) return null
  const [user = 0, nice = 0, system = 0, idle = 0, iowait = 0, irq = 0, softirq = 0, steal = 0] = fields
  const idleAll = idle + iowait
  const total = user + nice + system + idleAll + irq + softirq + steal
  if (total <= 0) return null
  return { idle: idleAll, total }
}

/** Share of non-idle ticks between two `/proc/stat` samples, 0..1. */
export function cpuUtilisation(first: ProcStatSample, second: ProcStatSample): number | null {
  const totalDelta = second.total - first.total
  const idleDelta = second.idle - first.idle
  if (totalDelta <= 0) return null
  const used = (totalDelta - idleDelta) / totalDelta
  if (!Number.isFinite(used)) return null
  return Math.min(1, Math.max(0, used))
}

function meminfoKilobytes(text: string, key: string): number | null {
  const match = text.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'))
  if (!match) return null
  const kilobytes = Number(match[1])
  return Number.isFinite(kilobytes) ? kilobytes * 1024 : null
}

/** `/proc/meminfo`. Used is total minus MemAvailable. */
export function parseMeminfo(text: string): CollectedMemory | null {
  const totalBytes = meminfoKilobytes(text, 'MemTotal')
  const availableBytes = meminfoKilobytes(text, 'MemAvailable')
  if (totalBytes === null || availableBytes === null || totalBytes <= 0) return null
  return {
    totalBytes,
    availableBytes,
    usedBytes: Math.max(0, totalBytes - availableBytes),
  }
}

/** `/proc/loadavg`. */
export function parseLoadavg(text: string): CollectedLoad | null {
  const parts = text.trim().split(/\s+/).slice(0, 3)
  if (parts.length < 3) return null
  const one = Number(parts[0])
  const five = Number(parts[1])
  const fifteen = Number(parts[2])
  if (![one, five, fifteen].every((value) => Number.isFinite(value))) return null
  return { one, five, fifteen }
}

/** `/proc/uptime`: seconds since boot. */
export function parseUptime(text: string): number | null {
  const seconds = Number(text.trim().split(/\s+/)[0])
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null
}

/** `sysctl kern.boottime` on Darwin: `{ sec = 1700000000, usec = 0 }`. */
export function parseSysctlBoottime(text: string, nowSeconds: number): number | null {
  const match = text.match(/sec\s*=\s*(\d+)/)
  if (!match) return null
  const boot = Number(match[1])
  if (!Number.isFinite(boot) || boot <= 0) return null
  const uptime = nowSeconds - boot
  return uptime >= 0 ? uptime : null
}

/** `/proc/cpuinfo` model line, or the ARM `Model` / `Hardware` fallback. */
export function parseCpuinfo(text: string): string | null {
  for (const key of ['model name', 'Model', 'Hardware']) {
    const match = text.match(new RegExp(`^${key}\\s*:\\s*(.+)$`, 'mi'))
    const value = match?.[1]?.trim()
    if (value) return value
  }
  return null
}

const MIB = 1024 * 1024

/**
 * `nvidia-smi --query-gpu=name,memory.total,memory.used,utilization.gpu
 * --format=csv,noheader,nounits`. Memory is MiB; utilisation is 0–100.
 */
export function parseNvidiaSmi(text: string): CollectedGpu[] {
  const gpus: CollectedGpu[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.toLowerCase().startsWith('failed') || trimmed.startsWith('NVIDIA-SMI')) {
      continue
    }
    const parts = trimmed.split(',').map((part) => part.trim())
    if (parts.length < 3) continue
    const [name, total, used, rawUtil] = parts
    if (!name) continue
    const memoryTotalBytes = Number(total) * MIB
    const memoryUsedBytes = Number(used) * MIB
    if (!Number.isFinite(memoryTotalBytes) || !Number.isFinite(memoryUsedBytes)) continue
    const percent = rawUtil === undefined || rawUtil === '' ? null : Number(rawUtil)
    gpus.push({
      name,
      memoryTotalBytes,
      memoryUsedBytes,
      utilisation: percent !== null && Number.isFinite(percent) ? Math.min(1, Math.max(0, percent / 100)) : null,
    })
  }
  return gpus
}

/** Collapse two storage rows that live on the same device. */
export function mergeStorage(
  docker: CollectedStorage | null,
  portta: CollectedStorage | null,
  sameDevice: boolean,
): CollectedStorage[] {
  if (docker && portta && sameDevice) {
    return [{ ...docker, role: 'both', path: docker.path === portta.path ? docker.path : `${docker.path} + ${portta.path}` }]
  }
  return [docker, portta].filter((entry): entry is CollectedStorage => entry !== null)
}
