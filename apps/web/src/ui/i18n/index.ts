import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import './types.ts'

import enCommon from './locales/en/common.json' with { type: 'json' }
import enNav from './locales/en/nav.json' with { type: 'json' }
import enOverview from './locales/en/overview.json' with { type: 'json' }
import enProjects from './locales/en/projects.json' with { type: 'json' }
import enEnvironments from './locales/en/environments.json' with { type: 'json' }
import enIssues from './locales/en/issues.json' with { type: 'json' }
import enServices from './locales/en/services.json' with { type: 'json' }
import enDocker from './locales/en/docker.json' with { type: 'json' }
import enNetwork from './locales/en/network.json' with { type: 'json' }
import enAccess from './locales/en/access.json' with { type: 'json' }
import enGateway from './locales/en/gateway.json' with { type: 'json' }
import enSettings from './locales/en/settings.json' with { type: 'json' }
import enDiagnostics from './locales/en/diagnostics.json' with { type: 'json' }
import enErrors from './locales/en/errors.json' with { type: 'json' }
import enAuth from './locales/en/auth.json' with { type: 'json' }

import ptCommon from './locales/pt-BR/common.json' with { type: 'json' }
import ptNav from './locales/pt-BR/nav.json' with { type: 'json' }
import ptOverview from './locales/pt-BR/overview.json' with { type: 'json' }
import ptProjects from './locales/pt-BR/projects.json' with { type: 'json' }
import ptEnvironments from './locales/pt-BR/environments.json' with { type: 'json' }
import ptIssues from './locales/pt-BR/issues.json' with { type: 'json' }
import ptServices from './locales/pt-BR/services.json' with { type: 'json' }
import ptDocker from './locales/pt-BR/docker.json' with { type: 'json' }
import ptNetwork from './locales/pt-BR/network.json' with { type: 'json' }
import ptAccess from './locales/pt-BR/access.json' with { type: 'json' }
import ptGateway from './locales/pt-BR/gateway.json' with { type: 'json' }
import ptSettings from './locales/pt-BR/settings.json' with { type: 'json' }
import ptDiagnostics from './locales/pt-BR/diagnostics.json' with { type: 'json' }
import ptErrors from './locales/pt-BR/errors.json' with { type: 'json' }
import ptAuth from './locales/pt-BR/auth.json' with { type: 'json' }

import { applyLocale } from './use-locale.ts'

function normalize(raw: string | null | undefined): 'en' | 'pt-BR' | null {
  if (!raw) return null
  const lower = raw.toLowerCase()
  if (lower === 'en' || lower.startsWith('en-')) return 'en'
  if (lower === 'pt' || lower === 'pt-br' || lower.startsWith('pt-')) return 'pt-BR'
  return null
}

function detect(): 'en' | 'pt-BR' {
  try {
    const stored = normalize(localStorage.getItem('portta-locale'))
    if (stored) return stored
  } catch {
    /* private browsing */
  }
  return normalize(navigator.language) ?? 'en'
}

const initial = detect()
applyLocale(initial)

void i18n.use(initReactI18next).init({
  lng: initial,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  resources: {
    en: {
      common: enCommon,
      nav: enNav,
      overview: enOverview,
      projects: enProjects,
      environments: enEnvironments,
      issues: enIssues,
      services: enServices,
      docker: enDocker,
      network: enNetwork,
      access: enAccess,
      gateway: enGateway,
      settings: enSettings,
      diagnostics: enDiagnostics,
      errors: enErrors,
      auth: enAuth,
    },
    'pt-BR': {
      common: ptCommon,
      nav: ptNav,
      overview: ptOverview,
      projects: ptProjects,
      environments: ptEnvironments,
      issues: ptIssues,
      services: ptServices,
      docker: ptDocker,
      network: ptNetwork,
      access: ptAccess,
      gateway: ptGateway,
      settings: ptSettings,
      diagnostics: ptDiagnostics,
      errors: ptErrors,
      auth: ptAuth,
    },
  },
})

export default i18n
