import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { DocumentationListQuery, DocumentationPageQuery, DocumentationSearchQuery } from 'portta-contracts'
import type { DocumentationReader, DocumentationOperation } from './docs.js'

export const DOC_TOOL_NAMES = ['list_docs', 'search_docs', 'get_doc'] as const
export function registerDocumentationTools(server: McpServer, read: DocumentationReader, origin: 'local' | 'panel') {
  const run = async (operation: DocumentationOperation, input: Record<string, unknown>) => {
    try {
      const result = { origin, ...await read(operation, input) }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result }
    } catch (error) {
      return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] }
    }
  }
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: origin === 'panel' }
  server.registerTool('list_docs', { title: 'List Portta documentation', description: 'List classified documentation and identify the selected corpus version.', inputSchema: DocumentationListQuery.shape, annotations }, (input) => run('list', input))
  server.registerTool('search_docs', { title: 'Search Portta documentation', description: 'Find concepts, instructions and references with excerpts and citable URLs.', inputSchema: DocumentationSearchQuery.shape, annotations }, (input) => run('search', input))
  server.registerTool('get_doc', { title: 'Read Portta documentation', description: 'Read canonical Markdown by slug, optionally limited to a heading subtree.', inputSchema: DocumentationPageQuery.shape, annotations }, (input) => run('show', input))
}
