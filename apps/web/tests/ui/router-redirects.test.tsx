import { describe, expect, it } from 'vitest'
import { legacyRedirect } from '../../src/ui/lib/redirects.ts'

describe('legacyRedirect', () => {
  it('sends the old workspace pages to the project pages', () => {
    expect(legacyRedirect('/workspaces')).toBe('/projects')
    expect(legacyRedirect('/workspaces/meu-produto')).toBe('/projects/meu-produto')
  })

  it('moves the board under its project and keeps the filters', () => {
    expect(legacyRedirect('/board/produto/board')).toBe('/projects/produto/board/board')
    expect(legacyRedirect('/board/produto/backlog?q=1&priority=urgent')).toBe(
      '/projects/produto/board/backlog?q=1&priority=urgent',
    )
    expect(legacyRedirect('/board/produto')).toBe('/projects/produto/board')
    expect(legacyRedirect('/board')).toBe('/projects')
  })

  it('leaves every current path alone', () => {
    for (const path of ['/overview', '/projects', '/projects/x/board', '/environments/alpha/logs?service=web', '/settings/tls']) {
      expect(legacyRedirect(path)).toBeNull()
    }
  })
})
