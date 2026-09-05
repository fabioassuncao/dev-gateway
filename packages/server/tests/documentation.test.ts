import { describe, expect, it, afterEach, vi } from 'vitest'
import { makeApp } from './helpers.ts'
import { loadDocumentation } from '../src/services/documentation.ts'
import { DocumentationIndex, DocumentationPageResponse, DocumentationSearchResponse } from 'portta-contracts'
import { searchDocumentation } from 'portta-core'

// Exercise the registered routes and authentication middleware with the real corpus.
vi.stubEnv('PORTTA_RUNTIME_DOCS_ROOT',new URL('../../../',import.meta.url).pathname)
afterEach(() => vi.unstubAllEnvs())
describe('documentation API', () => {
  it('lists, searches and reads the same versioned corpus', async () => {
    const { app } = makeApp()
    const corpus = loadDocumentation(new URL('../../../',import.meta.url).pathname)
    const index = await app.request('/api/documentation')
    expect(index.status).toBe(200)
    const listed = DocumentationIndex.parse(await index.json())
    expect(listed.identity.hash).toBe(corpus.identity.hash)
    expect(listed.pages.some((page) => /research|agent-guidelines/.test(page.source))).toBe(false)
    const search = await app.request('/api/documentation/search?q=DNS&audience=user&limit=3')
    expect(DocumentationSearchResponse.parse(await search.json()).results).toEqual(searchDocumentation(corpus.pages,'DNS',{ audience:'user',limit:3 }))
    const response = await app.request('/api/documentation/page?slug=addresses-and-access&anchor=dns')
    expect(response.status).toBe(200)
    const document = DocumentationPageResponse.parse(await response.json())
    expect(document.page.url).toBe('/docs/addresses-and-access#dns')
    expect(document.page.markdown.startsWith('## DNS')).toBe(true)
    expect(document.page).not.toHaveProperty('text')
  })
  it('rejects unknown documents, bad parameters and internal files', async () => {
    const { app } = makeApp()
    for (const url of ['/api/documentation/page?slug=agent-guidelines','/api/documentation/page?slug=install&anchor=missing']) expect((await app.request(url)).status).toBe(404)
    for (const url of ['/api/documentation/search?q=x&limit=51','/api/documentation/search?q=','/api/documentation/page?slug=../../secrets','/api/documentation?audience=internal']) expect((await app.request(url)).status).toBe(400)
  })
  it('requires an authenticated principal through the existing middleware', async () => {
    const { app, principals } = makeApp()
    const resolve = vi.spyOn(principals, 'fromHeaders').mockResolvedValue(null)
    try { expect((await app.request('/api/documentation')).status).toBe(401) }
    finally { resolve.mockRestore() }
  })
  it('respects disabled documentation in read-only mode', async () => {
    const { app } = makeApp({}, { docs:false, readOnly:true })
    for (const path of ['/api/documentation','/api/documentation/search?q=dns','/api/documentation/page?slug=install']) expect((await app.request(path)).status).toBe(404)
  })
})
