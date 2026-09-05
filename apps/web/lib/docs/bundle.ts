import 'server-only'
import { resolve } from 'node:path'
import { loadDocumentation } from 'portta-server'
import { renderDocumentation, type DocsBundle } from './collect.ts'

let cached: DocsBundle | undefined
export function repositoryRoot(): string { return process.env['PORTTA_RUNTIME_DOCS_ROOT'] ?? resolve(process.cwd(), '../..') }
export function docsBundle(): DocsBundle {
  const corpus = loadDocumentation(repositoryRoot())
  if (!cached || cached.corpus.identity.hash !== corpus.identity.hash) cached = renderDocumentation(corpus)
  return cached
}
export type { DocPage, DocSection, DocsBundle } from './collect.ts'
