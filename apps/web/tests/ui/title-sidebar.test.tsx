import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { renderWithQuery } from './render.tsx'
import { useSidebarCollapsed } from '../../src/ui/lib/sidebar.ts'
import { useDocumentTitle } from '../../src/ui/lib/title.ts'

function TitleProbe({ parts }: { parts: Array<string | null | undefined> }) {
  useDocumentTitle(...parts)
  return null
}

function SidebarProbe() {
  const [collapsed, toggle] = useSidebarCollapsed()
  return <button onClick={toggle}>{collapsed ? 'collapsed' : 'expanded'}</button>
}

beforeEach(() => {
  localStorage.clear()
  document.title = 'Portta'
  vi.restoreAllMocks()
})

describe('document titles', () => {
  it('joins known context and updates when a page learns more', () => {
    const view = renderWithQuery(<TitleProbe parts={['Projects', null]} />)
    expect(document.title).toBe('Projects · Portta')

    view.rerender(<TitleProbe parts={['Logs', 'alpha']} />)
    expect(document.title).toBe('Logs · alpha · Portta')
  })
})

describe('the sidebar preference', () => {
  it('writes and reads portta-sidebar', async () => {
    const first = renderWithQuery(<SidebarProbe />)
    await userEvent.click(screen.getByRole('button', { name: 'expanded' }))
    expect(screen.getByRole('button', { name: 'collapsed' })).toBeInTheDocument()
    expect(localStorage.getItem('portta-sidebar')).toBe('collapsed')

    first.unmount()
    renderWithQuery(<SidebarProbe />)
    expect(screen.getByRole('button', { name: 'collapsed' })).toBeInTheDocument()
  })

  it('falls back to expanded when storage cannot be read or written', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })

    renderWithQuery(<SidebarProbe />)
    const toggle = screen.getByRole('button', { name: 'expanded' })
    await userEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'collapsed' })).toBeInTheDocument()
  })
})
