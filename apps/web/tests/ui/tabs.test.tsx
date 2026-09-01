import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { Tabs, TabPanel } from '../../src/ui/components/ui/tabs.tsx'

const TABS = [
  { id: 'overview', label: 'Overview', href: '/projects/alpha/overview' },
  { id: 'services', label: 'Services', href: '/projects/alpha/services' },
  { id: 'git', label: 'Git', href: '/projects/alpha/git' },
]

beforeEach(() => {
  window.location.hash = '/projects/alpha'
})

describe('Tabs', () => {
  it('marks the active tab and links every tab to its own hash', () => {
    render(<Tabs tabs={TABS} active="services" label="alpha sections" />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false'])
    expect(tabs[1]).toHaveAttribute('href', '#/projects/alpha/services')
  })

  it('keeps only the active tab in the tab order', () => {
    render(<Tabs tabs={TABS} active="git" label="alpha sections" />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.getAttribute('tabindex'))).toEqual(['-1', '-1', '0'])
  })

  it('moves right, wraps at the end and jumps home with the keyboard', async () => {
    render(<Tabs tabs={TABS} active="overview" label="alpha sections" />)
    screen.getAllByRole('tab')[0]!.focus()

    await userEvent.keyboard('{ArrowRight}')
    expect(window.location.hash).toBe('#/projects/alpha/services')

    // `active` is fixed here, so ArrowLeft from the first tab must wrap.
    await userEvent.keyboard('{ArrowLeft}')
    expect(window.location.hash).toBe('#/projects/alpha/git')

    await userEvent.keyboard('{Home}')
    expect(window.location.hash).toBe('#/projects/alpha/overview')
  })

  it('associates the panel with its tab', () => {
    render(
      <>
        <Tabs tabs={TABS} active="git" label="alpha sections" />
        <TabPanel id="git">content</TabPanel>
      </>,
    )
    const panel = screen.getByRole('tabpanel')
    expect(panel).toHaveAttribute('aria-labelledby', 'tab-git')
    expect(screen.getByRole('tab', { selected: true })).toHaveAttribute('aria-controls', 'tabpanel-git')
  })
})
