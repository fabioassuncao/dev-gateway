import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

function stored(): Theme | null {
  try {
    const value = localStorage.getItem('dg-theme')
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(
    () => stored() ?? (document.documentElement.classList.contains('dark') ? 'dark' : 'light'),
  )

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    try {
      localStorage.setItem('dg-theme', theme)
    } catch {
      /* private browsing: the choice simply does not persist */
    }
  }, [theme])

  const toggle = useCallback(() => setTheme((current) => (current === 'dark' ? 'light' : 'dark')), [])
  return [theme, toggle]
}
