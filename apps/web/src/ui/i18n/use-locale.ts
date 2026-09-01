import { useCallback, useEffect, useState } from 'react'
import i18n from './index.ts'

export type Locale = 'en' | 'pt-BR'

const STORAGE_KEY = 'portta-locale'

function normalize(raw: string | null | undefined): Locale | null {
  if (!raw) return null
  const lower = raw.toLowerCase()
  if (lower === 'en' || lower.startsWith('en-')) return 'en'
  if (lower === 'pt' || lower === 'pt-br' || lower.startsWith('pt-')) return 'pt-BR'
  return null
}

function stored(): Locale | null {
  try {
    return normalize(localStorage.getItem(STORAGE_KEY))
  } catch {
    return null
  }
}

function detect(): Locale {
  return stored() ?? normalize(navigator.language) ?? 'en'
}

export function applyLocale(locale: Locale): void {
  document.documentElement.lang = locale === 'pt-BR' ? 'pt-BR' : 'en'
}

export function useLocale(): [Locale, (locale: Locale) => void] {
  const [locale, setLocale] = useState<Locale>(() => normalize(i18n.language) ?? detect())

  useEffect(() => {
    const onChange = (lng: string) => {
      const next = normalize(lng)
      if (next) setLocale(next)
    }
    i18n.on('languageChanged', onChange)
    return () => i18n.off('languageChanged', onChange)
  }, [])

  const change = useCallback((next: Locale) => {
    void i18n.changeLanguage(next)
    applyLocale(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* private browsing: the choice simply does not persist */
    }
  }, [])

  return [locale, change]
}
