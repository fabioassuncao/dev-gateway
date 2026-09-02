import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { apr1, generatePassword, hashPassword, isSupportedHash, randomSalt, verifyPassword } from './password.ts'

/**
 * The implementation is ours, so the test is against the tool everyone else
 * uses. Skipped rather than assumed when the machine has no openssl: the
 * gateway promises a host needs only Docker, Git and a shell.
 */
function opensslApr1(password: string, salt: string): string | null {
  try {
    return execFileSync('openssl', ['passwd', '-apr1', '-salt', salt, '-stdin'], {
      input: password,
      encoding: 'utf8',
    }).trim()
  } catch {
    return null
  }
}

describe('apr1', () => {
  it('matches the published vector', () => {
    expect(apr1('hunter2', 'abcdefgh')).toBe('$apr1$abcdefgh$ckT15POyCRlen.h6XtGAZ1')
  })

  it('agrees with openssl, including the cases that break naive ports', () => {
    const cases: [string, string][] = [
      ['hunter2', 'abcdefgh'],
      // Empty, because the length of the password drives its own bit walk.
      ['', 'salt1234'],
      // Longer than one MD5 block, which is where the repeat loop matters.
      ['a-much-longer-password-than-sixteen', 'Zz09./aB'],
      // A generated password, which is the only kind the gateway ever hashes.
      [generatePassword(), randomSalt()],
      ['ünïcodé and spaces', 'aB3.'],
    ]

    for (const [password, salt] of cases) {
      const reference = opensslApr1(password, salt)
      if (reference === null) return // no openssl on this machine
      // openssl declines to read an empty line from a pipe; nothing to compare.
      if (reference === '') continue
      expect(apr1(password, salt)).toBe(reference)
    }
  })

  it('is stable for one salt and different for another', () => {
    expect(apr1('secret', 'aaaaaaaa')).toBe(apr1('secret', 'aaaaaaaa'))
    expect(apr1('secret', 'aaaaaaaa')).not.toBe(apr1('secret', 'bbbbbbbb'))
  })

  it('never writes a salt longer than apr1 allows', () => {
    expect(apr1('secret', 'waytoolongasalt')).toMatch(/^\$apr1\$waytoolo\$/)
  })

  it('accepts a full hash as the salt, so a rehash keeps the salt', () => {
    const first = apr1('secret', 'abcdefgh')
    expect(apr1('secret', first)).toBe(first)
  })
})

describe('generatePassword', () => {
  it('is 20 characters over 32 symbols, so about 100 bits', () => {
    const password = generatePassword()
    expect(password.replace(/-/g, '')).toHaveLength(20)
    expect(password).toMatch(/^[23456789A-HJ-NP-Z]{5}(-[23456789A-HJ-NP-Z]{5}){3}$/)
  })

  it('omits the characters people misread aloud', () => {
    const sample = Array.from({ length: 200 }, () => generatePassword()).join('')
    expect(sample).not.toMatch(/[IO01]/)
  })

  it('does not repeat itself', () => {
    const seen = new Set(Array.from({ length: 100 }, () => generatePassword()))
    expect(seen.size).toBe(100)
  })
})

describe('isSupportedHash', () => {
  it('accepts what Traefik accepts', () => {
    expect(isSupportedHash(apr1('secret'))).toBe(true)
    expect(isSupportedHash('$2y$05$JQ8ISfHnzHUlYCbLPWiBluaEXsg7Rv3ziN2QcqL33ncOOUmDbo7Fu')).toBe(true)
  })

  it('refuses a password typed in where a hash belongs', () => {
    // The whole point: this is what stops a plaintext password reaching
    // Traefik because somebody filled in the wrong field.
    expect(isSupportedHash('hunter2')).toBe(false)
    expect(isSupportedHash('')).toBe(false)
    expect(isSupportedHash('$apr1$short')).toBe(false)
  })
})

describe('password verification', () => {
  it('writes and verifies the bounded Portta scrypt format', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(hash).toMatch(/^\$portta\$scrypt\$65536\$8\$1\$/)
    expect(isSupportedHash(hash)).toBe(true)
    await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true)
    await expect(verifyPassword('wrong', hash)).resolves.toBe(false)
  })

  it('keeps every format accepted before ForwardAuth', async () => {
    await expect(verifyPassword('hunter2', '$apr1$abcdefgh$ckT15POyCRlen.h6XtGAZ1')).resolves.toBe(true)
    await expect(verifyPassword('password', '$2b$05$QnEtvaOkCaotfJTC/OVCjuL94EHdMEoi.mJJfODg6kOrMStdhk/jK')).resolves.toBe(true)
    await expect(verifyPassword('password', '{SHA}W6ph5Mm5Pz8GgiULbPgzG37mj9g=')).resolves.toBe(true)
  })

  it('refuses malformed and unsupported values without throwing', async () => {
    await expect(verifyPassword('secret', '$portta$scrypt$999999999$8$1$bad$bad')).resolves.toBe(false)
    await expect(verifyPassword('secret', 'secret')).resolves.toBe(false)
  })
})
