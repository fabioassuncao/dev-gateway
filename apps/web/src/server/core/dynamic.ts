// The only three files the panel is allowed to write into Traefik's dynamic
// configuration directory.
//
// The directory is mounted read-write, which makes the panel able to configure
// Traefik. That capability is bounded by name rather than by intention: a write
// to any other path is refused here, before it happens, the way
// docker/allowlist.ts refuses a Docker call. Everything else in the directory
// (middlewares.yaml, tcp.yaml, local-tls.yaml, anything a user dropped in)
// belongs to the user and is never touched.
//
// See docs/adr/0011-panel-reads-traefik-writes-one-file.md.

import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  PANEL_AUTH_MIDDLEWARE,
  quoteDynamicValue,
  renderPanelAuth as renderSharedPanelAuth,
  UnsafeDynamicValueError,
} from 'portta-core'

/** The whole write surface. Nothing is added here without an ADR. */
export const GENERATED_FILES = {
  panel: 'portta-panel.yaml',
  shares: 'portta-shares.yaml',
  aliases: 'portta-aliases.yaml',
  auth: 'portta-auth.yaml',
} as const

export type GeneratedFile = (typeof GENERATED_FILES)[keyof typeof GENERATED_FILES]

const ALLOWED: readonly string[] = Object.values(GENERATED_FILES)

export { PANEL_AUTH_MIDDLEWARE }

export class DynamicWriteRefused extends Error {
  status = 403
  hint: string
  constructor(message: string, hint = 'this is a panel limit, not a filesystem one') {
    super(message)
    this.name = 'DynamicWriteRefused'
    this.hint = hint
  }
}

export function assertGenerated(name: string): asserts name is GeneratedFile {
  if (!ALLOWED.includes(name)) {
    throw new DynamicWriteRefused(
      `the panel only writes ${ALLOWED.join(', ')} in Traefik's dynamic directory`,
    )
  }
}

/** YAML double-quoted scalar. Refuses anything that would need escaping. */
export function quote(value: string): string {
  try { return quoteDynamicValue(value) }
  catch (error) {
    if (error instanceof UnsafeDynamicValueError) throw new DynamicWriteRefused(error.message)
    throw error
  }
}

export function renderPanelAuth(options: { user: string; hash: string } | null): string {
  try { return renderSharedPanelAuth(options) }
  catch (error) {
    if (error instanceof UnsafeDynamicValueError) throw new DynamicWriteRefused(error.message)
    throw error
  }
}

export function dynamicPath(dir: string, name: string): string {
  assertGenerated(name)
  return join(dir, name)
}

export function isDirWritable(dir: string): boolean {
  try {
    accessSync(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}

export function readGenerated(dir: string, name: string): string | null {
  const path = dynamicPath(dir, name)
  if (!existsSync(path)) return null
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/**
 * Writes through a temporary file in the same directory, so Traefik's watcher
 * never sees a half-written router. Mode 600: these files carry password
 * hashes, and Traefik reads them as root.
 */
export function writeGenerated(dir: string, name: string, contents: string): void {
  const path = dynamicPath(dir, name)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })

  const temporary = join(dir, `.portta-${name}.${process.pid}.tmp`)
  try {
    writeFileSync(temporary, contents, { mode: 0o600 })
    renameSync(temporary, path)
  } catch (cause) {
    try {
      if (existsSync(temporary)) unlinkSync(temporary)
    } catch {
      /* nothing else to do */
    }
    throw cause
  }
}

export function removeGenerated(dir: string, name: string): void {
  const path = dynamicPath(dir, name)
  if (!existsSync(path)) return
  unlinkSync(path)
}

/**
 * Brings `portta-panel.yaml` in line with the settings the panel was
 * started with. Returns what happened, because a panel that could not write is
 * a diagnostic rather than a crash: on Linux the directory may well belong to
 * another user, and `portta web auth set` writes the same file from the
 * host.
 */
export function reconcilePanelAuth(
  dir: string,
  auth: { mode: string; user: string; hash: string },
): { written: boolean; reason: string } {
  const wanted = renderPanelAuth(
    auth.mode === 'basic' && auth.user !== '' && auth.hash !== ''
      ? { user: auth.user, hash: auth.hash }
      : null,
  )

  const current = readGenerated(dir, GENERATED_FILES.panel)
  if (current === wanted) return { written: false, reason: 'already in step' }
  if (!isDirWritable(dir)) return { written: false, reason: 'the dynamic directory is not writable' }

  try {
    writeGenerated(dir, GENERATED_FILES.panel, wanted)
    return { written: true, reason: 'rendered from the current settings' }
  } catch (cause) {
    return { written: false, reason: String(cause) }
  }
}
