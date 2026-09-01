import type { TFunction } from 'i18next'

const VALIDATION_MAP: Record<string, string> = {
  'must be a hostname, for example dev.example.com': 'settings.validation.mustBeHostname',
  'must be a port between 1 and 65535': 'settings.validation.mustBePort',
  'must be an IPv4 address': 'settings.validation.mustBeIpv4',
  'must be 1 to 64 characters of letters, digits, dot, dash or underscore': 'settings.validation.mustBeUsername',
  'must be an apr1, bcrypt or SHA1 hash; run: dev-gateway web auth set': 'settings.validation.mustBePasswordHash',
  'must be an email address': 'settings.validation.mustBeEmail',
  'must be an https URL': 'settings.validation.mustBeHttpsUrl',
  'must be a URL': 'settings.validation.mustBeUrl',
  'must be the numeric App id': 'settings.validation.mustBeNumericAppId',
  'must be an absolute path': 'settings.validation.mustBeAbsolutePath',
  'is not a setting the panel manages': 'settings.validation.notManaged',
  'must be true or false': 'settings.validation.mustBeBoolean',
  'is required by the remote-public profile': 'settings.validation.publicDomainRequired',
  'the remote-private profile must not bind 0.0.0.0': 'settings.validation.bindAddressPrivate',
  'is required when TLS_MODE is acme': 'settings.validation.acmeEmailRequired',
  'is required when Tailscale is enabled': 'settings.validation.tailscaleHostnameRequired',
  'must be basic while the panel is routed': 'settings.validation.authBasicRequired',
  'a routed panel needs a credential: run dev-gateway web auth set': 'settings.validation.credentialRequired',
  'the panel is not published on every interface; reach it over the VPN instead':
    'settings.validation.panelNotOnEveryInterface',
}

const HINT_MAP: Record<string, string> = {
  'the value was not saved': 'errors.hints.notSaved',
  'existing Docker-backed pages remain available; run dev-gateway db status': 'errors.hints.databaseUnavailable',
  'this is a panel limit, not a Docker one': 'errors.hints.panelLimit',
  'unexpected failure': 'errors.hints.unexpected',
}

const ERROR_MAP: Record<string, string> = {
  'the panel is running in read-only mode': 'errors.readOnly',
  'cross-origin writes are refused': 'errors.crossOrigin',
  'bridge closed; the service itself was not touched': 'errors.bridgeClosed',
}

type TranslateFn = TFunction

/** Translates known API error strings; falls back to the original text. */
export function translateApiError(error: string, hint?: string, t?: TranslateFn): string {
  if (!t) return error

  if (ERROR_MAP[error]) return t(ERROR_MAP[error], { ns: 'errors' })

  const colon = error.indexOf(': ')
  if (colon > 0) {
    const key = error.slice(0, colon)
    const reason = error.slice(colon + 2)
    if (reason.startsWith('must be one of ')) {
      const choices = reason.slice('must be one of '.length)
      return `${key}: ${t('validation.mustBeOneOf', { ns: 'settings', choices })}`
    }
    const validationKey = VALIDATION_MAP[reason]
    if (validationKey) {
      const msgKey = validationKey.replace('settings.', '')
      return `${key}: ${t(msgKey, { ns: 'settings' })}`
    }
  }

  return error
}

export function translateApiHint(hint: string, t?: TranslateFn): string {
  if (!t) return hint
  const key = HINT_MAP[hint]
  return key ? t(key.replace('errors.', ''), { ns: 'errors' }) : hint
}
