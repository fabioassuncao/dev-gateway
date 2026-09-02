export const RESOURCE_WARN_RATIO = 0.85
export const MEMORY_WARN_RATIO = 0.9

export function resourceTone(
  ratio: number | null,
  kind: 'cpu' | 'memory' | 'storage' = 'storage',
): 'ok' | 'warn' | 'neutral' {
  if (ratio === null) return 'neutral'
  if (kind === 'cpu') return 'ok'
  if (kind === 'memory') return ratio >= MEMORY_WARN_RATIO ? 'warn' : 'ok'
  return ratio >= RESOURCE_WARN_RATIO ? 'warn' : 'ok'
}

export function percentLabel(ratio: number | null): string | null {
  if (ratio === null || !Number.isFinite(ratio)) return null
  return `${Math.round(ratio * 100)}%`
}
