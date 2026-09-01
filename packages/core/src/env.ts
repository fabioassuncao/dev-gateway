import { accessSync, constants, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
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

export function writeEnvFile(path: string, text: string): void {
  const temporary = join(dirname(path), `.dg-env.${process.pid}.tmp`)
  try {
    writeFileSync(temporary, text, { mode: 0o600 })
    renameSync(temporary, path)
  } catch (cause) {
    try { if (existsSync(temporary)) unlinkSync(temporary) } catch { /* best effort */ }
    try { writeFileSync(path, text, { mode: 0o600 }) } catch { throw cause }
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
