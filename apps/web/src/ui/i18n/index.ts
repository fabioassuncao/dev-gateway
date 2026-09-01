import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import './types.ts'

import enCommon from './locales/en/common.json'
import enNav from './locales/en/nav.json'
import enOverview from './locales/en/overview.json'
import enProjects from './locales/en/projects.json'
import enWorkspaces from './locales/en/workspaces.json'
import enIssues from './locales/en/issues.json'
import enServices from './locales/en/services.json'
import enDocker from './locales/en/docker.json'
import enNetwork from './locales/en/network.json'
import enAccess from './locales/en/access.json'
import enGateway from './locales/en/gateway.json'
import enSettings from './locales/en/settings.json'
import enDiagnostics from './locales/en/diagnostics.json'
import enErrors from './locales/en/errors.json'

import ptCommon from './locales/pt-BR/common.json'
import ptNav from './locales/pt-BR/nav.json'
import ptOverview from './locales/pt-BR/overview.json'
import ptProjects from './locales/pt-BR/projects.json'
import ptWorkspaces from './locales/pt-BR/workspaces.json'
import ptIssues from './locales/pt-BR/issues.json'
import ptServices from './locales/pt-BR/services.json'
import ptDocker from './locales/pt-BR/docker.json'
import ptNetwork from './locales/pt-BR/network.json'
import ptAccess from './locales/pt-BR/access.json'
import ptGateway from './locales/pt-BR/gateway.json'
import ptSettings from './locales/pt-BR/settings.json'
import ptDiagnostics from './locales/pt-BR/diagnostics.json'
import ptErrors from './locales/pt-BR/errors.json'

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
    const stored = normalize(localStorage.getItem('dg-locale'))
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
      workspaces: enWorkspaces,
      issues: enIssues,
      services: enServices,
      docker: enDocker,
      network: enNetwork,
      access: enAccess,
      gateway: enGateway,
      settings: enSettings,
      diagnostics: enDiagnostics,
      errors: enErrors,
    },
    'pt-BR': {
      common: ptCommon,
      nav: ptNav,
      overview: ptOverview,
      projects: ptProjects,
      workspaces: ptWorkspaces,
      issues: ptIssues,
      services: ptServices,
      docker: ptDocker,
      network: ptNetwork,
      access: ptAccess,
      gateway: ptGateway,
      settings: ptSettings,
      diagnostics: ptDiagnostics,
      errors: ptErrors,
    },
  },
})

export default i18n
