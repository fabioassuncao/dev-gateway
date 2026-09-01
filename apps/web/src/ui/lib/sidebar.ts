import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'portta-sidebar'

function stored(): boolean | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'collapsed' ? true : value === 'expanded' ? false : null
  } catch {
    return null
  }
}

export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => stored() ?? false)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? 'collapsed' : 'expanded')
    } catch {
      /* private browsing: the choice simply does not persist */
    }
  }, [collapsed])

  const toggle = useCallback(() => setCollapsed((current) => !current), [])
  return [collapsed, toggle]
}
