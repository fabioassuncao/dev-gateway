import { describe, expect, it } from 'vitest'
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
} from './host.ts'

const STAT_IDLE = `cpu  100 0 50 850 0 0 0 0 0 0
cpu0 100 0 50 850 0 0 0 0 0 0
`
const STAT_BUSY = `cpu  200 0 150 950 0 0 0 0 0 0
cpu0 200 0 150 950 0 0 0 0 0 0
`

const MEMINFO = `MemTotal:       16384000 kB
MemFree:         2048000 kB
MemAvailable:    8192000 kB
Buffers:          512000 kB
`

describe('the host collectors parse strings, not a machine', () => {
  it('computes utilisation from two /proc/stat samples', () => {
    const first = parseProcStat(STAT_IDLE)
    const second = parseProcStat(STAT_BUSY)
    expect(first).toEqual({ idle: 850, total: 1000 })
    expect(cpuUtilisation(first!, second!)).toBeCloseTo(2 / 3, 5)
  })

  it('refuses a /proc/stat that is not one', () => {
    expect(parseProcStat('not a stat file')).toBeNull()
    expect(parseProcStat('')).toBeNull()
  })

  it('reads MemAvailable, not a guess from MemFree', () => {
    expect(parseMeminfo(MEMINFO)).toEqual({
      totalBytes: 16384000 * 1024,
      availableBytes: 8192000 * 1024,
      usedBytes: 8192000 * 1024,
    })
    expect(parseMeminfo('SwapTotal: 1 kB')).toBeNull()
  })

  it('reads load, uptime and the CPU model', () => {
    expect(parseLoadavg('0.50 0.35 0.20 1/234 12345')).toEqual({ one: 0.5, five: 0.35, fifteen: 0.2 })
    expect(parseLoadavg('nope')).toBeNull()
    expect(parseUptime('12345.67 88888.88')).toBeCloseTo(12345.67)
    expect(parseUptime('not-a-number')).toBeNull()
    expect(parseCpuinfo('processor\t: 0\nmodel name\t: Intel(R) Core(TM) i7\n')).toBe('Intel(R) Core(TM) i7')
    expect(parseCpuinfo('Hardware\t: BCM2835\n')).toBe('BCM2835')
    expect(parseCpuinfo('nothing useful')).toBeNull()
  })

  it('turns Darwin kern.boottime into seconds of uptime', () => {
    expect(parseSysctlBoottime('{ sec = 1000, usec = 0 } }', 1600)).toBe(600)
    expect(parseSysctlBoottime('not a boottime', 1600)).toBeNull()
  })

  it('parses nvidia-smi CSV and skips a failed probe', () => {
    expect(parseNvidiaSmi('NVIDIA GeForce RTX 4090, 24564, 1234, 12\n')).toEqual([
      {
        name: 'NVIDIA GeForce RTX 4090',
        memoryTotalBytes: 24564 * 1024 * 1024,
        memoryUsedBytes: 1234 * 1024 * 1024,
        utilisation: 0.12,
      },
    ])
    expect(parseNvidiaSmi('Failed to initialize NVML: Driver/library version mismatch\n')).toEqual([])
    expect(parseNvidiaSmi('')).toEqual([])
  })

  it('shows one storage row when Docker and Portta share a filesystem', () => {
    const docker = {
      path: '/var/lib/docker',
      role: 'docker' as const,
      totalBytes: 100,
      usedBytes: 40,
      availableBytes: 60,
    }
    const portta = { ...docker, path: '/opt/portta', role: 'portta' as const }
    expect(mergeStorage(docker, portta, true)).toEqual([
      { ...docker, role: 'both', path: '/var/lib/docker + /opt/portta' },
    ])
    expect(mergeStorage(docker, portta, false)).toEqual([docker, portta])
  })
})
