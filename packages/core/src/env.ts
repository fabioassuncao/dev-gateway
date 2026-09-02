import { accessSync, chmodSync, constants, copyFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/

export function parseEnv(text: string): Map<string, string> {
  const values = new Map<string, string>()
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 0) continue
    let key = line.slice(0, separator).trim()
    if (key.startsWith('export ')) key = key.slice(7).trim()
    if (!KEY.test(key)) continue
    let value = line.slice(separator + 1)
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) value = value.slice(1, -1)
    else value = value.replace(/\s+$/, '')
    values.set(key, value)
  }
  return values
}

export function setEnvValue(text: string, key: string, value: string): string {
  if (!KEY.test(key)) throw new Error(`refusing to write invalid .env key: ${key}`)
  if (/[\n\r]/.test(value)) throw new Error(`refusing to write a multi-line value for ${key}`)
  const pattern = new RegExp(`^\\s*(export\\s+)?${key}=`)
  const lines = text.split('\n')
  let replaced = false
  const out = lines.map((line) => {
    if (!replaced && pattern.test(line)) {
      replaced = true
      return `${key}=${value}`
    }
    return line
  })
  if (replaced) return out.join('\n')
  const trimmed = text.replace(/\n+$/, '')
  return `${trimmed === '' ? '' : `${trimmed}\n`}${key}=${value}\n`
}

export function readEnvFile(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

export function isWritable(path: string): boolean {
  try {
    accessSync(existsSync(path) ? path : dirname(path), constants.W_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Rewrites .env **in place**, never through a rename.
 *
 * The atomic-rename version of this was safer against an interrupted write and
 * quietly broke the panel: .env is bind-mounted into the container as a single
 * file, and a file bind follows the inode. Replacing the file on the host left
 * the panel holding an unlinked one, so its Settings page reported .env as
 * missing — and stayed that way until the container was recreated. Any host-side
 * write did it: `portta config set`, `web up`, the installer, an editor.
 *
 * The previous contents are copied aside first and removed once the write
 * lands, so a failed write is rolled back and a hard kill leaves the old file
 * recoverable beside the new one rather than leaving nothing.
 */
export function writeEnvFile(path: string, text: string): void {
  const backup = join(dirname(path), `.portta-env.${process.pid}.bak`)
  const had = existsSync(path)
  if (had) {
    try { copyFileSync(path, backup) } catch { /* best effort: proceed without one */ }
  }
  try {
    writeFileSync(path, text, { mode: 0o600 })
    // `mode` only applies when writeFileSync creates the file, and writing in
    // place never does. .env holds secrets, so tighten it explicitly rather
    // than inheriting whatever it happened to have.
    chmodSync(path, 0o600)
  } catch (cause) {
    try { if (existsSync(backup)) copyFileSync(backup, path) } catch { /* best effort */ }
    throw cause
  } finally {
    try { if (existsSync(backup)) unlinkSync(backup) } catch { /* best effort */ }
  }
}

/** Compose-compatible precedence: the process environment wins over .env. */
export function mergeEnvironment(file: Map<string, string>, processEnv: NodeJS.ProcessEnv): Record<string, string> {
  const merged = Object.fromEntries(file)
  for (const [key, value] of Object.entries(processEnv)) {
    if (value !== undefined) merged[key] = value
  }
  return merged
}
