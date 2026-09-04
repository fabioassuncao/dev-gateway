import { useCallback, useEffect, useState } from 'react'

/** What the operator chose. `system` follows the OS and keeps following it. */
export type Theme = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'portta-theme'
const THEMES: Theme[] = ['light', 'dark', 'system']

function stored(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false
}

export function resolveTheme(theme: Theme, prefersDark = systemPrefersDark()): ResolvedTheme {
  return theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme
}

export function useTheme(): {
  theme: Theme
  resolved: ResolvedTheme
  setTheme: (theme: Theme) => void
  /** Light → dark → system, for the one-key shortcut. */
  cycle: () => void
} {
  const [theme, setThemeState] = useState<Theme>(stored)
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const resolved = resolveTheme(theme, prefersDark)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark')
    document.documentElement.style.colorScheme = resolved
  }, [resolved])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    try {
      // Only an explicit choice is stored; "system" is the absence of one, so
      // a person who never chose keeps following the OS.
      if (next === 'system') localStorage.removeItem(STORAGE_KEY)
      else localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* private browsing: the choice simply does not persist */
    }
  }, [])

  const cycle = useCallback(() => {
    setThemeState((current) => {
      const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length] ?? 'system'
      try {
        if (next === 'system') localStorage.removeItem(STORAGE_KEY)
        else localStorage.setItem(STORAGE_KEY, next)
      } catch {
        /* see above */
      }
      return next
    })
  }, [])

  return { theme, resolved, setTheme, cycle }
}
