// One answer to "is this environment fine", used by every row that shows one.

export type EnvironmentHealth = 'ok' | 'partial' | 'down' | 'unhealthy'

export function environmentHealth(counts: { serviceCount: number; runningCount: number; unhealthyCount: number }): EnvironmentHealth {
  if (counts.unhealthyCount > 0) return 'unhealthy'
  if (counts.serviceCount === 0 || counts.runningCount === 0) return 'down'
  if (counts.runningCount < counts.serviceCount) return 'partial'
  return 'ok'
}

export function healthTone(health: EnvironmentHealth): 'ok' | 'warn' | 'danger' | 'neutral' {
  switch (health) {
    case 'ok':
      return 'ok'
    case 'partial':
      return 'warn'
    case 'unhealthy':
      return 'danger'
    default:
      return 'neutral'
  }
}
