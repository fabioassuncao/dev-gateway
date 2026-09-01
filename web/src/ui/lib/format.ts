export function uptime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '-'
  if (seconds < 60) return `${Math.floor(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

export function relativeTime(epochSeconds: number | null | undefined): string {
  if (!epochSeconds) return '-'
  const delta = Math.floor(Date.now() / 1000) - epochSeconds
  if (delta < 0) return `in ${uptime(-delta)}`
  return `${uptime(delta)} ago`
}

export function expiresIn(epochSeconds: number | null | undefined): string {
  if (!epochSeconds) return 'no expiry'
  const remaining = epochSeconds - Math.floor(Date.now() / 1000)
  return remaining <= 0 ? 'expired' : `in ${uptime(remaining)}`
}

export function bytes(value: number | null | undefined): string {
  if (value === null || value === undefined || value <= 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size < 10 && unit > 0 ? size.toFixed(1) : Math.round(size)} ${units[unit]}`
}

export function shortId(id: string): string {
  return id.slice(0, 12)
}

/** Registry and digest noise hides the part a human is looking for. */
export function shortImage(image: string): string {
  const withoutDigest = image.split('@')[0] ?? image
  const parts = withoutDigest.split('/')
  return parts.length > 2 ? parts.slice(-2).join('/') : withoutDigest
}
