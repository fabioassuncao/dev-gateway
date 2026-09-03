import { describe, expect, it } from 'vitest'
import { legacyRedirect } from '../../src/ui/lib/redirects.ts'

describe('legacyRedirect', () => {
  it('sends the old workspace pages to the project pages', () => {
    expect(legacyRedirect('/workspaces')).toBe('/projects')
    expect(legacyRedirect('/workspaces/meu-produto')).toBe('/projects/meu-produto')
  })

  it('moves the board to the tasks tab and keeps the filters it still has', () => {
    expect(legacyRedirect('/board/produto/board')).toBe('/projects/produto/tasks')
    expect(legacyRedirect('/board/produto/backlog?q=1&priority=urgent')).toBe('/projects/produto/tasks?view=list&q=1')
    expect(legacyRedirect('/board/produto')).toBe('/projects/produto/tasks')
    expect(legacyRedirect('/board')).toBe('/projects')
    expect(legacyRedirect('/projects/produto/board/backlog?status=blocked')).toBe('/projects/produto/tasks?view=list&status=blocked')
  })

  it('leaves every current path alone', () => {
    for (const path of ['/overview', '/projects', '/projects/x/tasks?view=board', '/projects/x/tasks/42', '/environments/alpha/logs?service=web', '/settings/tls']) {
      expect(legacyRedirect(path)).toBeNull()
    }
  })
})
