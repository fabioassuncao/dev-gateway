import { useCallback, useEffect, useState } from 'react'

// Hash routing on purpose: the panel is served from a single endpoint that may
// sit behind a reverse proxy at an unknown base path, and a deep link should
// never depend on the server knowing about it.

export function currentPath(): string {
  const hash = window.location.hash.replace(/^#/, '')
  return hash === '' ? '/overview' : hash
}

export function navigate(to: string): void {
  window.location.hash = to
}

export function useRoute(): [string, (to: string) => void] {
  const [path, setPath] = useState(currentPath)

  useEffect(() => {
    const onChange = () => setPath(currentPath())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  const go = useCallback((to: string) => navigate(to), [])
  return [path, go]
}

/** Path segments, with any `?query` suffix removed. */
export function segments(path: string): string[] {
  const end = path.indexOf('?')
  return (end < 0 ? path : path.slice(0, end)).split('/').filter(Boolean)
}

/** One query parameter from a hash path such as `/projects/a/logs?service=api`. */
export function queryParam(path: string, key: string): string | null {
  const start = path.indexOf('?')
  if (start < 0) return null
  return new URLSearchParams(path.slice(start + 1)).get(key)
}
