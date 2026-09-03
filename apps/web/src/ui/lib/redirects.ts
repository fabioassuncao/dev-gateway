import { segments } from './router.ts'
import { boardToTasksHref } from './tasks.ts'

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
      return boardToTasksHref(decode(parts[1]), parts[2] ? decode(parts[2]) : null, query)
    case 'projects':
      // The board lived at /projects/:slug/board[/board|backlog] for one increment.
      if (parts[1] && parts[2] === 'board') return boardToTasksHref(decode(parts[1]), parts[3] ? decode(parts[3]) : null, query)
      return null
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
