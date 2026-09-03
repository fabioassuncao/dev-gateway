import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Overview } from '../../shared/types.ts'
import { splitDocRefs } from '../../shared/docs.ts'
import { api } from '../lib/api/index.ts'
import { keys } from '../lib/queries/keys.ts'

function useDocsEnabled(): boolean {
  const client = useQueryClient()
  const cached = client.getQueryData<Overview>(['status'])
  const { data } = useQuery({
    queryKey: keys.status(),
    queryFn: () => api.overview(),
    enabled: typeof api.overview === 'function',
    retry: false,
  })
  return (data ?? cached)?.gateway.panel.docs ?? true
}

/**
 * Turns citations like `docs/github.md` and `/docs/api` into deep links to
 * the documentation site. Plain text when the panel does not serve docs.
 */
export function DocText({ children }: { children: string }): ReactNode {
  const enabled = useDocsEnabled()
  if (!enabled) return children
  return splitDocRefs(children).map((part, index) =>
    part.href ? (
      <a
        key={`${part.href}:${index}`}
        href={part.href}
        target="_blank"
        rel="noreferrer"
        className="text-accent underline underline-offset-2 hover:text-accent"
      >
        {part.text}
      </a>
    ) : (
      <span key={index}>{part.text}</span>
    ),
  )
}
