import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { gatewayContext } from './context.js'

/**
 * A gateway root is VERSION plus the compose files the resolved configuration
 * names, so the fixture writes exactly those.
 */
function fixture(env: string): string {
  const root = mkdtempSync(join(tmpdir(), 'portta-context-'))
  mkdirSync(join(root, 'docker/compose/attach'), { recursive: true })
  mkdirSync(join(root, 'docker/compose/profiles'), { recursive: true })
  mkdirSync(join(root, 'docker/compose/features'), { recursive: true })
  writeFileSync(join(root, 'VERSION'), '0.2.0\n')
  for (const file of ['compose.yaml', 'attach/host.yaml', 'profiles/local.yaml', 'features/web.yaml', 'features/db.yaml', 'features/web-bind.yaml']) {
    writeFileSync(join(root, 'docker/compose', file), '{}\n')
  }
  writeFileSync(join(root, '.env'), env)
  return root
}

describe('the environment wins over the file, except right after a write', () => {
  let root: string
  const saved = process.env['PORTTA_WEB']

  beforeEach(() => { root = fixture('PORTTA_WEB=true\n') })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    if (saved === undefined) delete process.env['PORTTA_WEB']
    else process.env['PORTTA_WEB'] = saved
  })

  it('an inherited value normally beats the file, so PORTTA_X=y portta up works', () => {
    process.env['PORTTA_WEB'] = 'false'
    expect(gatewayContext({ root }).config.webEnabled).toBe(false)
  })

  // The regression: `web up` wrote PORTTA_WEB=true, re-resolved, and read the
  // inherited false back. Compose was then handed a file list without the
  // panel overlays and asked to start `web`, which answered "no such service".
  it('but a value just written wins, or the overlays it selects go missing', () => {
    process.env['PORTTA_WEB'] = 'false'
    const context = gatewayContext({ root, overrides: { PORTTA_WEB: 'true' } })
    expect(context.config.webEnabled).toBe(true)
    expect(context.composeFiles).toContain('docker/compose/features/web.yaml')
  })
})
