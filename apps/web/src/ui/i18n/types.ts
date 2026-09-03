import type common from './locales/en/common.json'
import type nav from './locales/en/nav.json'
import type overview from './locales/en/overview.json'
import type projects from './locales/en/projects.json'
import type environments from './locales/en/environments.json'
import type issues from './locales/en/issues.json'
import type services from './locales/en/services.json'
import type docker from './locales/en/docker.json'
import type network from './locales/en/network.json'
import type access from './locales/en/access.json'
import type gateway from './locales/en/gateway.json'
import type settings from './locales/en/settings.json'
import type diagnostics from './locales/en/diagnostics.json'
import type errors from './locales/en/errors.json'
import type auth from './locales/en/auth.json'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: {
      common: typeof common
      nav: typeof nav
      overview: typeof overview
      projects: typeof projects
      environments: typeof environments
      issues: typeof issues
      services: typeof services
      docker: typeof docker
      network: typeof network
      access: typeof access
      gateway: typeof gateway
      settings: typeof settings
      diagnostics: typeof diagnostics
      errors: typeof errors
      auth: typeof auth
    }
  }
}
