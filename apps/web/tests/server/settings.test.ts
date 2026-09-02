import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEnv, setEnvValue } from '../../src/server/core/envfile.ts'
import { buildConfigView, patchConfig } from '../../src/server/core/configview.ts'
import { validateCombination, validateValue, ValidationError } from '../../src/server/core/settings.ts'
import { makeApp, testConfig } from './helpers.ts'
import type { ConfigView } from '../../src/shared/types.ts'

describe('parsing .env the way the CLI does', () => {
  it('reads plain assignments and skips comments', () => {
    const values = parseEnv('# a comment\nFOO=bar\n\nBAZ=qux\n')
    expect(values.get('FOO')).toBe('bar')
    expect(values.get('BAZ')).toBe('qux')
    expect(values.size).toBe(2)
  })

  it('tolerates `export` and strips one layer of quotes', () => {
    const values = parseEnv('export FOO="bar"\nBAR=\'baz\'\n')
    expect(values.get('FOO')).toBe('bar')
    expect(values.get('BAR')).toBe('baz')
  })

  it('never executes what it reads', () => {
    const values = parseEnv('FOO=$(rm -rf /)\nBAR=`whoami`\n')
    expect(values.get('FOO')).toBe('$(rm -rf /)')
    expect(values.get('BAR')).toBe('`whoami`')
  })

  it('ignores a key that is not a shell identifier', () => {
    expect(parseEnv('not a key=value\nA-B=c\n').size).toBe(0)
  })
})

describe('rewriting .env', () => {
  it('replaces a value in place, keeping the comments around it', () => {
    const before = '# the domain\nPORTTA_DOMAIN=localhost\n# tls\nTLS_ENABLED=false\n'
    const after = setEnvValue(before, 'PORTTA_DOMAIN', 'dev.test')
    expect(after).toBe('# the domain\nPORTTA_DOMAIN=dev.test\n# tls\nTLS_ENABLED=false\n')
  })

  it('appends a key that is not there yet', () => {
    expect(setEnvValue('A=1\n', 'B', '2')).toBe('A=1\nB=2\n')
  })

  it('refuses a key or a value that would corrupt the file', () => {
    expect(() => setEnvValue('', 'BAD KEY', 'x')).toThrowError(/invalid .env key/)
    expect(() => setEnvValue('', 'GOOD', 'line1\nEVIL=1')).toThrowError(/multi-line/)
  })
})

describe('validation', () => {
  it('checks each value against its own rules', () => {
    expect(() => validateValue('PORTTA_HTTP_PORT', '70000')).toThrow(ValidationError)
    expect(() => validateValue('PORTTA_DOMAIN', 'not a domain')).toThrow(ValidationError)
    expect(() => validateValue('TLS_MODE', 'sometimes')).toThrow(ValidationError)
    expect(() => validateValue('TLS_ENABLED', 'maybe')).toThrow(ValidationError)
    expect(() => validateValue('ACME_EMAIL', 'nope')).toThrow(ValidationError)
    expect(() => validateValue('SOMETHING_ELSE', 'x')).toThrowError(/not a setting the panel manages/)
  })

  it('accepts the values the gateway actually uses', () => {
    expect(() => validateValue('PORTTA_DOMAIN', 'vpn.example.com')).not.toThrow()
    expect(() => validateValue('PORTTA_BIND_ADDRESS', '100.64.0.1')).not.toThrow()
    expect(() => validateValue('PUBLIC_DOMAIN', '')).not.toThrow()
    expect(() => validateValue('PORTTA_PROFILE', 'remote-private')).not.toThrow()
    expect(() => validateValue('PORTTA_PROJECTS_HOME', '/srv/projects')).not.toThrow()
    expect(() => validateValue('PORTTA_PROJECTS_HOME', '')).not.toThrow()
    expect(() => validateValue('PORTTA_PROJECTS_HOME', '/')).toThrow(ValidationError)
    expect(() => validateValue('PORTTA_PROJECTS_HOME', '/srv/projects/../..')).toThrow(ValidationError)
  })

  // The panel reads this path; `portta doctor` translates it back to the host.
  // Only `./state/github` is mounted, so a path outside it names a file that is
  // not in the container at all, and the two diagnostics would disagree about a
  // key neither of them could authenticate with.
  it('takes the key filename GitHub gave, and only from the mounted directory', () => {
    const key = 'GITHUB_APP_PRIVATE_KEY_FILE'

    expect(() => validateValue(key, '/app/state/github/portta.2026-09-02.private-key.pem')).not.toThrow()
    expect(() => validateValue(key, '/app/state/github/app.pem')).not.toThrow()
    // Empty falls through to the same default in Compose and in config.ts.
    expect(() => validateValue(key, '')).not.toThrow()

    expect(() => validateValue(key, '/run/secrets/app.pem')).toThrowError(/mounted into the panel/)
    expect(() => validateValue(key, 'app.pem')).toThrow(ValidationError)
    expect(() => validateValue(key, '/app/state/github/')).toThrow(ValidationError)
    expect(() => validateValue(key, '/app/state/github-old/app.pem')).toThrow(ValidationError)
    expect(() => validateValue(key, '/app/state/github/../../etc/shadow')).toThrow(ValidationError)
  })

  it('refuses combinations the CLI would refuse at startup', () => {
    expect(() =>
      validateCombination(new Map([['PORTTA_PROFILE', 'remote-public']])),
    ).toThrowError(/PUBLIC_DOMAIN/)

    expect(() =>
      validateCombination(
        new Map([
          ['PORTTA_PROFILE', 'remote-private'],
          ['PORTTA_BIND_ADDRESS', '0.0.0.0'],
        ]),
      ),
    ).toThrowError(/must not bind 0.0.0.0/)

    expect(() =>
      validateCombination(
        new Map([
          ['TLS_ENABLED', 'true'],
          ['TLS_MODE', 'acme'],
        ]),
      ),
    ).toThrowError(/ACME_EMAIL/)
  })

  it('refuses to publish the panel on every interface', () => {
    expect(() =>
      validateCombination(new Map([['PORTTA_WEB_BIND_ADDRESS', '0.0.0.0']])),
    ).toThrowError(/not published on every interface/)
  })
})

describe('the Settings view and its writes', () => {
  let dir: string
  let envFile: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'portta-web-'))
    envFile = join(dir, '.env')
    writeFileSync(
      envFile,
      '# gateway\nPORTTA_DOMAIN=localhost\nTLS_ENABLED=false\nTS_AUTHKEY=tskey_auth_secret_value\n',
    )
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('never returns a secret value', () => {
    const view = buildConfigView(testConfig({ envFile }))
    const token = view.fields.find((field) => field.key === 'TS_AUTHKEY')
    expect(token?.secret).toBe(true)
    expect(token?.isSet).toBe(true)
    expect(token?.value).toBeNull()
    expect(JSON.stringify(view)).not.toContain('tskey_auth_secret_value')
  })

  it('never returns the panel database password', () => {
    writeFileSync(envFile, `${readFileSync(envFile, 'utf8')}PORTTA_RUNTIME_DB_PASSWORD=database-secret-value\n`)
    const view = buildConfigView(testConfig({ envFile }))
    const password = view.fields.find((field) => field.key === 'PORTTA_RUNTIME_DB_PASSWORD')

    expect(password?.secret).toBe(true)
    expect(password?.isSet).toBe(true)
    expect(password?.value).toBeNull()
    expect(JSON.stringify(view)).not.toContain('database-secret-value')
  })

  it('flags a saved value that the running gateway has not picked up', () => {
    process.env['PORTTA_DOMAIN'] = 'localhost'
    const before = buildConfigView(testConfig({ envFile }))
    expect(before.fields.find((f) => f.key === 'PORTTA_DOMAIN')?.pending).toBe(false)

    patchConfig(testConfig({ envFile }), { PORTTA_DOMAIN: 'dev.test' })
    const after = buildConfigView(testConfig({ envFile }))
    expect(after.fields.find((f) => f.key === 'PORTTA_DOMAIN')?.pending).toBe(true)
    expect(after.pendingRestart).toBe(true)
    expect(after.applyCommand).toBe('./bin/portta up local')
    delete process.env['PORTTA_DOMAIN']
  })

  it('writes the file with mode 600', () => {
    patchConfig(testConfig({ envFile }), { PORTTA_DOMAIN: 'dev.test' })
    expect(statSync(envFile).mode & 0o777).toBe(0o600)
  })

  it('leaves a secret alone when the form sends an empty string', () => {
    patchConfig(testConfig({ envFile }), { TS_AUTHKEY: '' })
    expect(readFileSync(envFile, 'utf8')).toContain('TS_AUTHKEY=tskey_auth_secret_value')
  })

  it('clears a secret when explicitly asked to', () => {
    patchConfig(testConfig({ envFile }), { TS_AUTHKEY: null })
    expect(readFileSync(envFile, 'utf8')).toContain('TS_AUTHKEY=\n')
    expect(readFileSync(envFile, 'utf8')).not.toContain('tskey_auth_secret_value')
  })

  it('normalises the spellings people write for a boolean', () => {
    patchConfig(testConfig({ envFile }), { TLS_ENABLED: 'yes' })
    expect(readFileSync(envFile, 'utf8')).toContain('TLS_ENABLED=true')
  })

  it('writes nothing at all when one value in the batch is invalid', () => {
    const before = readFileSync(envFile, 'utf8')
    expect(() =>
      patchConfig(testConfig({ envFile }), {
        PORTTA_DOMAIN: 'dev.test',
        PORTTA_HTTP_PORT: '-1',
      }),
    ).toThrow(ValidationError)
    expect(readFileSync(envFile, 'utf8')).toBe(before)
  })

  it('refuses a key that is not in the catalogue', () => {
    expect(() => patchConfig(testConfig({ envFile }), { PATH: '/tmp' })).toThrowError(
      /not a setting the panel manages/,
    )
    expect(readFileSync(envFile, 'utf8')).not.toContain('PATH=')
  })

  it('keeps the comments in the file', () => {
    patchConfig(testConfig({ envFile }), { PORTTA_DOMAIN: 'dev.test' })
    expect(readFileSync(envFile, 'utf8')).toContain('# gateway')
  })
})

describe('the config endpoints', () => {
  let dir: string
  let envFile: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'portta-web-api-'))
    envFile = join(dir, '.env')
    writeFileSync(envFile, 'PORTTA_DOMAIN=localhost\nCF_DNS_API_TOKEN=super-secret\n')
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('serves the catalogue without any secret in it', async () => {
    const { app } = makeApp({ containers: [] }, { envFile })
    const body = await (await app.request('/api/config')).text()
    expect(body).not.toContain('super-secret')
    const view = JSON.parse(body) as ConfigView
    expect(view.envFile.writable).toBe(true)
    expect(view.groups).toContain('Gateway')
  })

  it('saves through PATCH and reports what needs recreating', async () => {
    const { app } = makeApp({ containers: [] }, { envFile })
    const response = await app.request('/api/config', {
      method: 'PATCH',
      body: JSON.stringify({ values: { PORTTA_DOMAIN: 'dev.test' } }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
    })
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.saved).toEqual(['PORTTA_DOMAIN'])
    expect(result.applyCommand).toContain('portta up')
    expect(readFileSync(envFile, 'utf8')).toContain('PORTTA_DOMAIN=dev.test')
  })

  it('answers 400 with the offending key, and writes nothing', async () => {
    const { app } = makeApp({ containers: [] }, { envFile })
    const response = await app.request('/api/config', {
      method: 'PATCH',
      body: JSON.stringify({ values: { PORTTA_HTTP_PORT: 'eighty' } }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
    })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('PORTTA_HTTP_PORT')
    expect(readFileSync(envFile, 'utf8')).not.toContain('eighty')
  })
})

describe('the panel refuses to be routed without a credential', () => {
  const routed = (extra: Record<string, string> = {}) =>
    new Map(
      Object.entries({
        PORTTA_WEB_EXPOSE: 'vpn',
        PORTTA_WEB_AUTH: 'basic',
        PORTTA_WEB_AUTH_USER: 'dev',
        PORTTA_WEB_AUTH_HASH: '$apr1$abcdefgh$ckT15POyCRlen.h6XtGAZ1',
        ...extra,
      }),
    )

  it('accepts a routed panel with a full credential', () => {
    expect(() => validateCombination(routed())).not.toThrow()
  })

  it('refuses the routed panel with authentication off', () => {
    expect(() => validateCombination(routed({ PORTTA_WEB_AUTH: 'none' }))).toThrow(ValidationError)
  })

  it('refuses a mode of basic with nothing behind it', () => {
    expect(() => validateCombination(routed({ PORTTA_WEB_AUTH_HASH: '' }))).toThrow(ValidationError)
    expect(() => validateCombination(routed({ PORTTA_WEB_AUTH_USER: '' }))).toThrow(ValidationError)
  })

  it('asks for none of it on loopback, where it would protect nothing', () => {
    expect(() =>
      validateCombination(
        new Map([
          ['PORTTA_WEB_EXPOSE', 'local'],
          ['PORTTA_WEB_AUTH', 'none'],
        ]),
      ),
    ).not.toThrow()
  })
})

describe('a dashboard on the domain', () => {
  it('needs a credential and a real domain', () => {
    expect(() =>
      validateCombination(new Map([
        ['PORTTA_DASHBOARD', 'true'],
        ['PORTTA_DASHBOARD_EXPOSE', 'domain'],
        ['PORTTA_DOMAIN', 'localhost'],
      ])),
    ).toThrow(ValidationError)
    expect(() =>
      validateCombination(new Map([
        ['PORTTA_DASHBOARD', 'true'],
        ['PORTTA_DASHBOARD_EXPOSE', 'domain'],
        ['PORTTA_DOMAIN', 'dev.example.com'],
      ])),
    ).toThrow(ValidationError)
    expect(() =>
      validateCombination(new Map([
        ['PORTTA_DASHBOARD', 'true'],
        ['PORTTA_DASHBOARD_EXPOSE', 'domain'],
        ['PORTTA_DOMAIN', 'dev.example.com'],
        ['PORTTA_WEB_AUTH', 'basic'],
        ['PORTTA_WEB_AUTH_USER', 'dev'],
        ['PORTTA_WEB_AUTH_HASH', '$apr1$abcdefgh$ckT15POyCRlen.h6XtGAZ1'],
      ])),
    ).not.toThrow()
  })
})

describe('the password hash field takes a hash, never a password', () => {
  it('accepts what Traefik accepts', () => {
    expect(() =>
      validateValue('PORTTA_WEB_AUTH_HASH', '$apr1$abcdefgh$ckT15POyCRlen.h6XtGAZ1'),
    ).not.toThrow()
  })

  it('refuses a plaintext password typed into the field', () => {
    expect(() => validateValue('PORTTA_WEB_AUTH_HASH', 'hunter2')).toThrow(ValidationError)
  })

  it('refuses a username that could break the generated YAML', () => {
    expect(() => validateValue('PORTTA_WEB_AUTH_USER', 'dev"user')).toThrow(ValidationError)
    expect(() => validateValue('PORTTA_WEB_AUTH_USER', 'dev:admin')).toThrow(ValidationError)
  })
})

describe('saving a credential rewrites the ForwardAuth contract Traefik reads', () => {
  it('renders the generated file next to .env', () => {
    const dir = mkdtempSync(join(tmpdir(), 'portta-settings-'))
    const config = testConfig({ envFile: join(dir, '.env'), dynamicDir: dir })
    writeFileSync(config.envFile, 'PORTTA_WEB_EXPOSE=local\n')

    const result = patchConfig(config, {
      PORTTA_WEB_AUTH: 'basic',
      PORTTA_WEB_AUTH_USER: 'dev',
      PORTTA_WEB_AUTH_HASH: '$apr1$abcdefgh$ckT15POyCRlen.h6XtGAZ1',
    })

    expect(result.dynamic?.written).toBe(true)
    const rendered = readFileSync(join(dir, 'portta-auth.yaml'), 'utf8')
    expect(rendered).toContain('portta-web-auth:')
    expect(rendered).toContain('forwardAuth:')
    expect(rendered).not.toContain('$apr1$')
    rmSync(dir, { recursive: true, force: true })
  })

  it('never returns the hash it just stored', () => {
    const dir = mkdtempSync(join(tmpdir(), 'portta-settings-'))
    const config = testConfig({ envFile: join(dir, '.env'), dynamicDir: dir })
    writeFileSync(config.envFile, '')

    const result = patchConfig(config, {
      PORTTA_WEB_AUTH_HASH: '$apr1$abcdefgh$ckT15POyCRlen.h6XtGAZ1',
    })
    const field = result.view.fields.find((item) => item.key === 'PORTTA_WEB_AUTH_HASH')
    expect(field?.isSet).toBe(true)
    expect(field?.value).toBeNull()
    expect(JSON.stringify(result)).not.toContain('ckT15POyCRlen')
    rmSync(dir, { recursive: true, force: true })
  })
})
