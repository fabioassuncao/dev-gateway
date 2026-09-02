export const RESOURCE_WARN_RATIO = 0.85

export function resourceTone(ratio: number | null): 'ok' | 'warn' | 'neutral' {
  if (ratio === null) return 'neutral'
  return ratio >= RESOURCE_WARN_RATIO ? 'warn' : 'ok'
}

export function percentLabel(ratio: number | null): string | null {
  if (ratio === null || !Number.isFinite(ratio)) return null
  return `${Math.round(ratio * 100)}%`
}
