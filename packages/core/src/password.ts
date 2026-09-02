// Apache's apr1 password hash, and the passwords the gateway generates for it.
//
// Traefik accepts MD5 (apr1), SHA1 and bcrypt in `basicAuth.users`. This image
// has three runtime dependencies and that smallness is part of what makes it
// safe to run, so the hash is implemented here rather than pulled in.
//
// The reason that is defensible is what gets hashed: the gateway never hashes a
// password a person chose. `generatePassword` produces about a hundred bits,
// where the entropy is the boundary and the iteration count is not. Someone who
// insists on their own password pastes a hash they made themselves. See
// docs/adr/0011-panel-reads-traefik-writes-one-file.md.

import { createHash, randomBytes, randomInt, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto'
import { compare as bcryptCompare } from 'bcryptjs'

const MAGIC = '$apr1$'
const ITOA64 = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
/** No 0, 1, I or O: this password is read aloud and typed by hand. */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const SALT_CHARS = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const SCRYPT_PREFIX = '$portta$scrypt$'
const SCRYPT_N = 65_536
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEY_LENGTH = 32
const SCRYPT_MAX_MEMORY = 96 * 1024 * 1024
function scryptPassword(password: string, salt: Buffer, length: number, options: { N: number; r: number; p: number; maxmem: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(password, salt, length, options, (error, derived) => {
      if (error) reject(error)
      else resolve(derived)
    })
  })
}

function md5(...parts: Buffer[]): Buffer {
  const hash = createHash('md5')
  for (const part of parts) hash.update(part)
  return hash.digest()
}

function to64(value: number, count: number): string {
  let out = ''
  let rest = value
  for (let index = 0; index < count; index += 1) {
    out += ITOA64[rest & 0x3f]
    rest >>= 6
  }
  return out
}

export function randomSalt(length = 8): string {
  let out = ''
  for (let index = 0; index < length; index += 1) {
    out += SALT_CHARS[randomInt(SALT_CHARS.length)]
  }
  return out
}

/**
 * A password worth generating: 20 characters over a 32-symbol alphabet, which
 * is 100 bits. Grouped with dashes because it gets copied by hand.
 */
export function generatePassword(groups = 4, size = 5): string {
  const parts: string[] = []
  for (let group = 0; group < groups; group += 1) {
    let chunk = ''
    for (let index = 0; index < size; index += 1) chunk += ALPHABET[randomInt(ALPHABET.length)]
    parts.push(chunk)
  }
  return parts.join('-')
}

/**
 * `$apr1$<salt>$<22 chars>`, byte for byte what `openssl passwd -apr1` writes.
 * `password.test.ts` checks that against the real openssl when the
 * machine running the suite has one.
 */
export function apr1(password: string, salt = randomSalt()): string {
  const cleanSalt = salt.replace(/^\$apr1\$/, '').split('$')[0]?.slice(0, 8) ?? ''
  const pw = Buffer.from(password, 'utf8')
  const saltBuffer = Buffer.from(cleanSalt, 'utf8')

  const alternate = md5(pw, saltBuffer, pw)

  const parts: Buffer[] = [pw, Buffer.from(MAGIC, 'utf8'), saltBuffer]
  for (let remaining = pw.length; remaining > 0; remaining -= 16) {
    parts.push(alternate.subarray(0, Math.min(remaining, 16)))
  }
  // The length of the password walks its own bits: a zero byte for a set bit,
  // the first byte of the password for a clear one. Odd, and load-bearing.
  for (let remaining = pw.length; remaining > 0; remaining >>= 1) {
    parts.push(remaining & 1 ? Buffer.from([0]) : pw.subarray(0, 1))
  }

  let digest = md5(...parts)

  for (let round = 0; round < 1000; round += 1) {
    const next: Buffer[] = []
    next.push(round & 1 ? pw : digest)
    if (round % 3) next.push(saltBuffer)
    if (round % 7) next.push(pw)
    next.push(round & 1 ? digest : pw)
    digest = md5(...next)
  }

  const d = digest
  const encoded =
    to64(((d[0] as number) << 16) | ((d[6] as number) << 8) | (d[12] as number), 4) +
    to64(((d[1] as number) << 16) | ((d[7] as number) << 8) | (d[13] as number), 4) +
    to64(((d[2] as number) << 16) | ((d[8] as number) << 8) | (d[14] as number), 4) +
    to64(((d[3] as number) << 16) | ((d[9] as number) << 8) | (d[15] as number), 4) +
    to64(((d[4] as number) << 16) | ((d[10] as number) << 8) | (d[5] as number), 4) +
    to64(d[11] as number, 2)

  return `${MAGIC}${cleanSalt}$${encoded}`
}

/** Whether a stored value looks like something Traefik will accept. */
export function isSupportedHash(value: string): boolean {
  return (
    /^\$portta\$scrypt\$65536\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/.test(value) ||
    /^\$apr1\$[./0-9A-Za-z]{1,8}\$[./0-9A-Za-z]{22}$/.test(value) ||
    /^\$2[aby]?\$\d{2}\$[./0-9A-Za-z]{53}$/.test(value) ||
    /^\{SHA\}[A-Za-z0-9+/]{27}=$/.test(value)
  )
}

function equal(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right)
}

/** Hash a newly supplied password with the one format Portta owns. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = await scryptPassword(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAX_MEMORY,
  })
  return `${SCRYPT_PREFIX}${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64url')}$${derived.toString('base64url')}`
}

async function verifyScrypt(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$')
  if (parts.length !== 8 || parts[1] !== 'portta' || parts[2] !== 'scrypt') return false
  const n = Number(parts[3])
  const r = Number(parts[4])
  const p = Number(parts[5])
  if (n !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) return false
  const salt = Buffer.from(parts[6] ?? '', 'base64url')
  const wanted = Buffer.from(parts[7] ?? '', 'base64url')
  if (salt.length !== 16 || wanted.length !== SCRYPT_KEY_LENGTH) return false
  const actual = await scryptPassword(password, salt, wanted.length, { N: n, r, p, maxmem: SCRYPT_MAX_MEMORY })
  return equal(actual, wanted)
}

/** Verify Portta's scrypt hashes and every format accepted before ADR 0027. */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  try {
    if (encoded.startsWith(SCRYPT_PREFIX)) return verifyScrypt(password, encoded)
    if (encoded.startsWith('$apr1$')) {
      return equal(Buffer.from(apr1(password, encoded)), Buffer.from(encoded))
    }
    if (/^\$2[aby]?\$/.test(encoded)) return bcryptCompare(password, encoded)
    if (encoded.startsWith('{SHA}')) {
      const actual = `{SHA}${createHash('sha1').update(password, 'utf8').digest('base64')}`
      return equal(Buffer.from(actual), Buffer.from(encoded))
    }
    return false
  } catch {
    return false
  }
}
