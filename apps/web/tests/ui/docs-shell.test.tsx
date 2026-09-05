import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DocsShell } from '@/components/docs/docs-shell'
import { renderWithQuery } from './render'
import { navigation } from './setup'
import type { DocumentationPage } from 'portta-core/browser'

const page: DocumentationPage = { slug:'domains',title:'Configure domains',description:'Create a wildcard record.',audience:'user',section:'Guides',category:'Networking',source:'docs/product/a.md',url:'/docs/domains',markdown:'',text:'Configure hostnames and TLS',headings:[],kind:'markdown' }
const developer: DocumentationPage = { ...page,slug:'testing',title:'Testing',audience:'developer',section:'Development',category:'',url:'/docs/testing',description:'Validate your changes.' }
const sections = [page,developer].map((page) => ({ title:page.section,category:page.category,audience:page.audience,sequential:false,pages:[{ slug:page.slug,title:page.title,summary:page.description }] }))
beforeEach(() => { navigation.pathname='/docs'; navigation.push.mockReset(); HTMLElement.prototype.scrollTo=vi.fn() })
const setup = () => renderWithQuery(<DocsShell sections={sections} searchPages={[page,developer]} version="test"><h1>Documentation</h1></DocsShell>)
describe('documentation navigation and search', () => {
  it('separates audiences without hiding the other area permanently', async () => {
    setup(); const user=userEvent.setup()
    expect(screen.queryByRole('link',{ name:'Testing' })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Documentation audience'),'developer')
    expect(screen.getByRole('link',{ name:'Testing' })).toHaveAttribute('href','/docs/testing')
  })
  it('finds body text and supports keyboard selection and no results', async () => {
    setup(); const user=userEvent.setup()
    const input=screen.getByRole('combobox',{ name:'Search the documentation' })
    await user.click(input); await user.type(input,'hostnames')
    expect(screen.getByRole('status')).toHaveTextContent('1 results')
    await user.keyboard('{ArrowDown}{Enter}')
    expect(navigation.push).toHaveBeenCalledWith('/docs/domains')
    await user.click(input); await user.clear(input); await user.type(input,'unknown')
    expect(screen.getByRole('status')).toHaveTextContent('No matching documentation.')
    await user.keyboard('{Escape}')
    expect(input).toHaveAttribute('aria-expanded','false')
  })
  it('opens and dismisses mobile navigation, restoring focus', async () => {
    setup(); const user=userEvent.setup()
    const trigger=screen.getByRole('button',{ name:'Open documentation navigation' })
    await user.click(trigger)
    expect(within(screen.getByRole('dialog')).getByLabelText('Documentation audience')).toBeVisible()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})
