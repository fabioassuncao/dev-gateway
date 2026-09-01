// Reading and writing the gateway's .env, with the same rules the CLI uses.
//
// The file is parsed, never executed, and it is rewritten through a temporary
// file in the same directory so an interrupted write cannot truncate the
// user's configuration. Mirrors dg_load_env and dg_env_set in
// scripts/lib/common.sh.

import { readFileSync, writeFileSync, renameSync, existsSync, accessSync, constants, unlinkSync } from 'node:fs'
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
    if (key.startsWith('export ')) key = key.slice('export '.length).trim()
    if (!KEY.test(key)) continue

    let value = line.slice(separator + 1)
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1)
    } else {
      value = value.replace(/\s+$/, '')
    }
    values.set(key, value)
  }
  return values
}

/**
 * Rewrites the line for `key` where it already is, keeping its position and the
 * comments around it, and appends it otherwise.
 */
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
  if (!existsSync(path)) return ''
  return readFileSync(path, 'utf8')
}

export function isWritable(path: string): boolean {
  try {
    if (existsSync(path)) {
      accessSync(path, constants.W_OK)
      return true
    }
    accessSync(dirname(path), constants.W_OK)
    return true
  } catch {
    return false
  }
}

export function writeEnvFile(path: string, text: string): void {
  const temporary = join(dirname(path), `.dg-web-env.${process.pid}.tmp`)
  try {
    writeFileSync(temporary, text, { mode: 0o600 })
    renameSync(temporary, path)
  } catch (cause) {
    // A bind-mounted single file cannot be renamed over; fall back to a
    // truncating write, which is what Compose leaves us with.
    try {
      if (existsSync(temporary)) unlinkSync(temporary)
    } catch {
      /* nothing else to do */
    }
    try {
      writeFileSync(path, text, { mode: 0o600 })
    } catch {
      throw cause
    }
  }
}
