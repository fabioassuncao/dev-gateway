// Reading what `portta host collect` wrote on the host, and what GET /info
// already said about the same machine.
//
// The panel cannot look at the host: os.uptime() here is the container.
// Static facts come from the Engine (which runs on the host). Dynamic facts
// come from one file, the way readProjectGit reads state/git. A missing or
// malformed file is a smaller object, never a 500.
// See docs/adr/0010-git-collected-on-the-host.md.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { PanelConfig } from '../config.ts'
import type { DockerInfo } from '../docker/types.ts'
import type { HostResources } from '../../shared/types.ts'

const COLLECT_HINT = 'portta host collect'
const MAX_FILE_BYTES = 64 * 1024

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function usedPercent(used: number | null, total: number | null): number | null {
  if (used === null || total === null || total <= 0) return null
  return used / total
}

export function hostFileFor(config: PanelConfig): string {
  return join(config.hostDir, 'host.json')
}

function readCollected(config: PanelConfig, now: number): {
  raw: Record<string, unknown> | null
  collectedAt: number | null
  ageSeconds: number | null
  stale: boolean
} {
  const file = hostFileFor(config)
  if (!existsSync(file)) {
    return { raw: null, collectedAt: null, ageSeconds: null, stale: false }
  }
  try {
    if (statSync(file).size > MAX_FILE_BYTES) {
      return { raw: null, collectedAt: null, ageSeconds: null, stale: false }
    }
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
    const raw = asRecord(parsed)
    if (!raw) return { raw: null, collectedAt: null, ageSeconds: null, stale: false }
    const collectedAt = asNumber(raw.collectedAt)
    const ageSeconds = collectedAt !== null && collectedAt > 0
      ? Math.max(0, Math.floor(now / 1000) - collectedAt)
      : null
    return {
      raw,
      collectedAt: collectedAt !== null && collectedAt > 0 ? collectedAt : null,
      ageSeconds,
      stale: ageSeconds !== null && ageSeconds > config.hostStaleSeconds,
    }
  } catch {
    return { raw: null, collectedAt: null, ageSeconds: null, stale: false }
  }
}

function storageFrom(raw: unknown): HostResources['storage'] {
  if (!Array.isArray(raw)) return []
  const rows: HostResources['storage'] = []
  for (const entry of raw) {
    const value = asRecord(entry)
    if (!value) continue
    const totalBytes = asNumber(value.totalBytes)
    const usedBytes = asNumber(value.usedBytes)
    const availableBytes = asNumber(value.availableBytes)
    const path = asString(value.path)
    const role = value.role
    if (!path || totalBytes === null || usedBytes === null || availableBytes === null) continue
    if (role !== 'docker' && role !== 'portta' && role !== 'both') continue
    rows.push({
      path,
      role,
      totalBytes,
      usedBytes,
      availableBytes,
      usedPercent: usedPercent(usedBytes, totalBytes) ?? 0,
    })
  }
  return rows
}

function gpuFrom(raw: unknown): HostResources['gpu'] {
  if (!Array.isArray(raw)) return []
  const rows: HostResources['gpu'] = []
  for (const entry of raw) {
    const value = asRecord(entry)
    if (!value) continue
    const name = asString(value.name)
    const memoryTotalBytes = asNumber(value.memoryTotalBytes)
    const memoryUsedBytes = asNumber(value.memoryUsedBytes)
    if (!name || memoryTotalBytes === null || memoryUsedBytes === null) continue
    rows.push({
      name,
      memoryTotalBytes,
      memoryUsedBytes,
      utilisation: asNumber(value.utilisation),
    })
  }
  return rows
}

export function hostResources(
  info: DockerInfo | null,
  config: PanelConfig,
  now = Date.now(),
): HostResources {
  const collected = readCollected(config, now)
  const raw = collected.raw
  const cpuRaw = asRecord(raw?.cpu)
  const memoryRaw = asRecord(raw?.memory)
  const loadRaw = asRecord(raw?.load)

  const collectedMemoryTotal = asNumber(memoryRaw?.totalBytes)
  const dockerMemoryTotal = info?.MemTotal && info.MemTotal > 0 ? info.MemTotal : null
  const usedBytes = asNumber(memoryRaw?.usedBytes)
  const availableBytes = asNumber(memoryRaw?.availableBytes)
  const totalBytes = collectedMemoryTotal ?? dockerMemoryTotal

  const hasDocker = info !== null
  const hasCollector = raw !== null

  return {
    system: {
      hostname: asString(info?.Name) ?? null,
      os: asString(info?.OperatingSystem) ?? null,
      osVersion: asString(info?.OSVersion) ?? null,
      kernel: asString(info?.KernelVersion) ?? null,
      architecture: asString(info?.Architecture) ?? null,
      uptimeSeconds: asNumber(raw?.uptimeSeconds),
      source: hasDocker && hasCollector ? 'mixed' : hasDocker ? 'docker' : 'collector',
    },
    cpu: {
      model: asString(cpuRaw?.model),
      cores: info?.NCPU && info.NCPU > 0 ? info.NCPU : null,
      utilisation: asNumber(cpuRaw?.utilisation),
      load: loadRaw && asNumber(loadRaw.one) !== null && asNumber(loadRaw.five) !== null && asNumber(loadRaw.fifteen) !== null
        ? { one: loadRaw.one as number, five: loadRaw.five as number, fifteen: loadRaw.fifteen as number }
        : null,
      source: hasDocker && (cpuRaw !== null || loadRaw !== null) ? 'mixed' : hasDocker ? 'docker' : 'collector',
    },
    memory: {
      totalBytes,
      usedBytes,
      availableBytes,
      usedPercent: usedPercent(usedBytes, totalBytes),
      source: usedBytes !== null && dockerMemoryTotal !== null ? 'mixed' : usedBytes !== null ? 'collector' : 'docker',
    },
    storage: storageFrom(raw?.storage),
    gpu: gpuFrom(raw?.gpu),
    collectedAt: collected.collectedAt,
    ageSeconds: collected.ageSeconds,
    stale: collected.stale,
    hint: hasCollector ? null : COLLECT_HINT,
  }
}
