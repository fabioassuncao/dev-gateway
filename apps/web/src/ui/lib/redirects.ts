import { segments } from './router.ts'

/**
 * Where an old hash goes now, or null when the path is current.
 *
 * Every entry here is a URL somebody may have bookmarked or pasted before the
 * rename: the words changed, the pages did not, so the panel answers with the
 * new address rather than an empty page. Nothing is resolved by guessing;
 * a `#/projects/<slug>` that turns out to be an environment is handled by the
 * project page itself, after one request, in `LegacyEnvironmentRedirect`.
 */
export function legacyRedirect(path: string): string | null {
  const parts = segments(path)
  const start = path.indexOf('?')
  const query = start < 0 ? '' : path.slice(start)
  const encode = (segment: string) => encodeURIComponent(decode(segment))

  switch (parts[0]) {
    case 'workspaces':
      return parts[1] ? `/projects/${encode(parts[1])}${query}` : `/projects${query}`
    case 'board':
      if (!parts[1]) return '/projects'
      return `/projects/${encode(parts[1])}/board${parts[2] ? `/${encode(parts[2])}` : ''}${query}`
    default:
      return null
  }
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}
