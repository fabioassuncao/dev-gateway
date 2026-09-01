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

export function segments(path: string): string[] {
  return path.split('/').filter(Boolean)
}
