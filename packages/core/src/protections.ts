import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { API_CAPABILITIES, isApiCapability, type ApiCapability } from './capabilities-api.ts'

export const PROTECTION_STORE_VERSION = 1 as const

export interface ProtectionTech {
  id: string
  label: string
}

export interface ProtectionRecord {
  scope: string
  host: string
  entryPoints: string[]
  user: string
  hash: string
  epoch: number
  label: string
  project?: string
  service?: string
  tech?: ProtectionTech
}

export interface ProtectionStore {
  version: typeof PROTECTION_STORE_VERSION
  protections: ProtectionRecord[]
  tokens: ApiTokenRecord[]
}

export interface ApiTokenRecord {
  id: string
  name: string
  actor: string
  actorKind: 'human' | 'agent'
  hash: string
  capabilities: ApiCapability[]
  createdAt: string
  revokedAt: string | null
}

export interface PanelProtectionInput {
  mode: string
  expose: string
  user: string
  hash: string
  webHost: string
  domain: string
  advertisedHost?: string | null
  port: string
  tlsEnabled: boolean
  projectName: string
}

export class InvalidProtectionStore extends Error {}

function authority(host: string, port: string): string {
  if (host.includes(':') || port === '80' || port === '443') return host
  return `${host}:${port}`
}

/** Derive the panel's exact routed host from the same settings as Compose. */
export function panelProtectionRecord(input: PanelProtectionInput): Omit<ProtectionRecord, 'epoch'> | null {
  if (input.mode !== 'basic' || !input.user || !input.hash || !['vpn', 'public', 'domain'].includes(input.expose)) return null
  if (input.expose === 'public' && !input.advertisedHost) {
    throw new InvalidProtectionStore('a public panel needs an advertised host')
  }
  // `domain` is routed on the gateway's own entrypoint, so the host is a bare
  // hostname with no port: the entrypoint's port is the one every application
  // answers on. It is the advertised host verbatim, which is what the Compose
  // router matches on -- the two must agree or the panel fails closed.
  if (input.expose === 'domain' && !input.advertisedHost) {
    throw new InvalidProtectionStore('a panel routed on the domain needs an advertised host')
  }
  const host = input.expose === 'public'
    ? authority(input.advertisedHost!, input.port)
    : input.expose === 'domain'
      ? input.advertisedHost!
      : `${input.webHost}.${input.domain}`
  return {
    scope: 'panel', host,
    entryPoints: [input.expose === 'public' ? 'panel' : input.tlsEnabled ? 'websecure' : 'web'],
    user: input.user, hash: input.hash, label: 'Portta panel', project: input.projectName,
    service: 'web', tech: { id: 'docker', label: 'Portta' },
  }
}

/** A second host the panel credential covers, so the login router accepts it. */
export function dashboardProtectionRecord(input: {
  expose: string
  advertisedHost: string | null
  mode: string
  user: string
  hash: string
  tlsEnabled: boolean
  projectName: string
}): Omit<ProtectionRecord, 'epoch'> | null {
  if (input.expose !== 'domain' || input.mode !== 'basic' || !input.user || !input.hash || !input.advertisedHost) {
    return null
  }
  return {
    scope: 'dashboard',
    host: input.advertisedHost,
    entryPoints: [input.tlsEnabled ? 'websecure' : 'web'],
    user: input.user,
    hash: input.hash,
    label: 'Traefik dashboard',
    project: input.projectName,
    service: 'traefik',
    tech: { id: 'traefik', label: 'Traefik' },
  }
}

export function emptyProtectionStore(): ProtectionStore {
  return { version: PROTECTION_STORE_VERSION, protections: [], tokens: [] }
}

export function normalizeProtectionHost(input: string): string {
  const value = input.trim()
  if (value === '' || /[\u0000-\u0020\\/#?@]/.test(value) || value.includes('://')) {
    throw new InvalidProtectionStore(`invalid protection host: ${input}`)
  }
  let url: URL
  try {
    url = new URL(`http://${value}`)
  } catch {
    throw new InvalidProtectionStore(`invalid protection host: ${input}`)
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new InvalidProtectionStore(`invalid protection host: ${input}`)
  }
  const hostname = url.hostname.endsWith('.') ? url.hostname.slice(0, -1) : url.hostname
  return `${hostname.toLowerCase()}${url.port ? `:${url.port}` : ''}`
}

function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '' || /[\r\n\u0000]/.test(value)) {
    throw new InvalidProtectionStore(`invalid ${field}`)
  }
  return value
}

function parseRecord(value: unknown): ProtectionRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InvalidProtectionStore('invalid protection record')
  const item = value as Record<string, unknown>
  const entryPoints = item['entryPoints']
  if (!Array.isArray(entryPoints) || entryPoints.length === 0 || !entryPoints.every((entry) => typeof entry === 'string' && /^[A-Za-z0-9_-]+$/.test(entry))) {
    throw new InvalidProtectionStore('invalid entryPoints')
  }
  if (!Number.isSafeInteger(item['epoch']) || Number(item['epoch']) < 1) throw new InvalidProtectionStore('invalid epoch')
  const record: ProtectionRecord = {
    scope: nonEmpty(item['scope'], 'scope'),
    host: normalizeProtectionHost(nonEmpty(item['host'], 'host')),
    entryPoints: [...new Set(entryPoints as string[])].sort(),
    user: nonEmpty(item['user'], 'user'),
    hash: nonEmpty(item['hash'], 'hash'),
    epoch: Number(item['epoch']),
    label: nonEmpty(item['label'], 'label'),
  }
  if (item['project'] !== undefined) record.project = nonEmpty(item['project'], 'project')
  if (item['service'] !== undefined) record.service = nonEmpty(item['service'], 'service')
  if (item['tech'] !== undefined) {
    if (!item['tech'] || typeof item['tech'] !== 'object' || Array.isArray(item['tech'])) throw new InvalidProtectionStore('invalid tech')
    const tech = item['tech'] as Record<string, unknown>
    record.tech = { id: nonEmpty(tech['id'], 'tech.id'), label: nonEmpty(tech['label'], 'tech.label') }
  }
  return record
}

function parseToken(value: unknown): ApiTokenRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InvalidProtectionStore('invalid API token record')
  const item = value as Record<string, unknown>
  if (!Array.isArray(item['capabilities']) || !item['capabilities'].every((entry) => typeof entry === 'string' && isApiCapability(entry))) throw new InvalidProtectionStore('invalid token capabilities')
  const actorKind = item['actorKind']
  if (actorKind !== 'human' && actorKind !== 'agent') throw new InvalidProtectionStore('invalid token actorKind')
  const revokedAt = item['revokedAt']
  if (revokedAt !== null && typeof revokedAt !== 'string') throw new InvalidProtectionStore('invalid token revokedAt')
  return {
    id: nonEmpty(item['id'], 'token id'), name: nonEmpty(item['name'], 'token name'), actor: nonEmpty(item['actor'], 'token actor'), actorKind,
    hash: nonEmpty(item['hash'], 'token hash'), capabilities: [...new Set(item['capabilities'] as ApiCapability[])].sort(),
    createdAt: nonEmpty(item['createdAt'], 'token createdAt'), revokedAt,
  }
}

export function parseProtectionStore(text: string): ProtectionStore {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new InvalidProtectionStore('protection store is not valid JSON')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InvalidProtectionStore('invalid protection store')
  const object = value as Record<string, unknown>
  if (object['version'] !== PROTECTION_STORE_VERSION || !Array.isArray(object['protections'])) {
    throw new InvalidProtectionStore('unsupported protection store version')
  }
  const protections = object['protections'].map(parseRecord)
  const rawTokens = object['tokens'] ?? []
  if (!Array.isArray(rawTokens)) throw new InvalidProtectionStore('invalid API tokens')
  const tokens = rawTokens.map(parseToken)
  const scopes = new Set<string>()
  const hosts = new Set<string>()
  for (const protection of protections) {
    if (scopes.has(protection.scope)) throw new InvalidProtectionStore(`duplicate protection scope: ${protection.scope}`)
    if (hosts.has(protection.host)) throw new InvalidProtectionStore(`duplicate protection host: ${protection.host}`)
    scopes.add(protection.scope)
    hosts.add(protection.host)
  }
  if (new Set(tokens.map((token) => token.id)).size !== tokens.length) throw new InvalidProtectionStore('duplicate API token id')
  return { version: PROTECTION_STORE_VERSION, protections: protections.sort((left, right) => left.scope.localeCompare(right.scope)), tokens: tokens.sort((left, right) => left.id.localeCompare(right.id)) }
}

export function readProtectionStore(path: string): ProtectionStore {
  if (!existsSync(path)) return emptyProtectionStore()
  return parseProtectionStore(readFileSync(path, 'utf8'))
}

export function writeProtectionStore(path: string, store: ProtectionStore): void {
  const canonical = parseProtectionStore(`${JSON.stringify(store)}\n`)
  const directory = dirname(path)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const temporary = join(directory, `.${randomBytes(8).toString('hex')}.tmp`)
  let descriptor: number | null = null
  try {
    descriptor = openSync(temporary, 'wx', 0o600)
    writeFileSync(descriptor, `${JSON.stringify(canonical, null, 2)}\n`, 'utf8')
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = null
    renameSync(temporary, path)
    chmodSync(path, 0o600)
  } finally {
    if (descriptor !== null) closeSync(descriptor)
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

export function setProtection(store: ProtectionStore, input: Omit<ProtectionRecord, 'epoch' | 'host'> & { host: string }): ProtectionStore {
  const host = normalizeProtectionHost(input.host)
  const previous = store.protections.find((item) => item.scope === input.scope)
  const collision = store.protections.find((item) => item.host === host && item.scope !== input.scope)
  if (collision) throw new InvalidProtectionStore(`host ${host} is already protected by ${collision.scope}`)
  const next: ProtectionRecord = { ...input, host, entryPoints: [...new Set(input.entryPoints)].sort(), epoch: (previous?.epoch ?? 0) + 1 }
  return parseProtectionStore(JSON.stringify({ ...store, protections: [...store.protections.filter((item) => item.scope !== input.scope), next] }))
}

export function removeProtection(store: ProtectionStore, scope: string): ProtectionStore {
  return { ...store, protections: store.protections.filter((item) => item.scope !== scope) }
}

export function protectionForHost(store: ProtectionStore, host: string): ProtectionRecord | null {
  const normalized = normalizeProtectionHost(host)
  return store.protections.find((item) => item.host === normalized) ?? null
}

function tokenHash(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest()
}

/** Create a bearer credential. The raw value is returned once; only its digest is stored. */
export function createApiToken(store: ProtectionStore, input: { name: string; actor: string; actorKind?: 'human' | 'agent'; capabilities?: readonly ApiCapability[] }, now = new Date()): { store: ProtectionStore; token: string; record: ApiTokenRecord } {
  const name = nonEmpty(input.name.trim(), 'token name')
  const actor = nonEmpty(input.actor.trim(), 'token actor')
  const token = `ptt_${randomBytes(32).toString('base64url')}`
  const record: ApiTokenRecord = {
    id: randomBytes(8).toString('hex'), name, actor, actorKind: input.actorKind ?? 'agent',
    hash: tokenHash(token).toString('hex'), capabilities: [...new Set(input.capabilities ?? API_CAPABILITIES)].sort(),
    createdAt: now.toISOString(), revokedAt: null,
  }
  return { store: parseProtectionStore(JSON.stringify({ ...store, tokens: [...store.tokens, record] })), token, record }
}

export function apiTokenFor(store: ProtectionStore, secret: string): ApiTokenRecord | null {
  if (!secret.startsWith('ptt_')) return null
  const candidate = tokenHash(secret)
  for (const token of store.tokens) {
    if (token.revokedAt || !/^[a-f0-9]{64}$/.test(token.hash)) continue
    const stored = Buffer.from(token.hash, 'hex')
    if (stored.length === candidate.length && timingSafeEqual(stored, candidate)) return token
  }
  return null
}

export function revokeApiToken(store: ProtectionStore, id: string, now = new Date()): ProtectionStore {
  if (!store.tokens.some((token) => token.id === id)) throw new InvalidProtectionStore(`unknown API token: ${id}`)
  return parseProtectionStore(JSON.stringify({ ...store, tokens: store.tokens.map((token) => token.id === id ? { ...token, revokedAt: token.revokedAt ?? now.toISOString() } : token) }))
}
