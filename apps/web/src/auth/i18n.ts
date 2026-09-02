import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '../ui/i18n/locales/en/auth.json' with { type: 'json' }
import ptBR from '../ui/i18n/locales/pt-BR/auth.json' with { type: 'json' }

export function initializeAuthI18n(locale: 'en' | 'pt-BR') {
  if (!i18n.isInitialized) {
    void i18n.use(initReactI18next).init({
      lng: locale,
      fallbackLng: 'en',
      resources: { en: { auth: en }, 'pt-BR': { auth: ptBR } },
      defaultNS: 'auth',
      interpolation: { escapeValue: false },
    })
  } else void i18n.changeLanguage(locale)
  return i18n
}
