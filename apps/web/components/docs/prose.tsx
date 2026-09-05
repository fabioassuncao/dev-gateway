'use client'

import { useEffect, useRef } from 'react'
import { useDarkTheme } from '@/lib/theme'
import { renderMermaid } from '@/lib/docs/mermaid'
import { copyText } from '@/lib/clipboard'

/**
 * A rendered documentation page, with its Mermaid fences drawn.
 *
 * The HTML is the project's own documentation, rendered on the server from the
 * repository's Markdown. A table (and the tags a table needs) is passed through
 * after an allowlist; a raw `<script>` or an event handler is escaped, so
 * nothing a user typed reaches here at all. If this component ever renders
 * something a user supplied, it needs a sanitiser first.
 *
 * Mermaid runs in the browser because it measures text to lay a diagram out,
 * and there is nothing to measure on the server.
 */
export function Prose({ html, slug }: { html: string; slug: string }) {
  const container = useRef<HTMLDivElement>(null)
  const dark = useDarkTheme()

  useEffect(() => {
    const element = container.current
    if (!element) return
    let cancelled = false
    void renderMermaid(element, dark, () => cancelled)
    return () => {
      cancelled = true
    }
  }, [slug, dark])

  useEffect(() => {
    const element = container.current
    if (!element) return
    const cleanups: Array<() => void> = []
    for (const pre of element.querySelectorAll('pre')) {
      const code = pre.querySelector('code')
      if (!code || code.classList.contains('language-mermaid')) continue
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'docs-copy focus-ring'
      const language = [...code.classList].find((name) => name.startsWith('language-'))?.slice(9) ?? 'code'
      button.textContent = `Copy ${language}`
      button.setAttribute('aria-label', `Copy ${language} code`)
      const status = document.createElement('span')
      status.className = 'sr-only'
      status.setAttribute('role', 'status')
      const copy = async () => {
        try { await copyText(code.textContent ?? ''); status.textContent = 'Code copied.' }
        catch { status.textContent = 'Copy failed. Select and copy the code manually.' }
      }
      button.addEventListener('click', copy)
      pre.before(button, status)
      cleanups.push(() => { button.removeEventListener('click',copy); button.remove(); status.remove() })
    }
    return () => cleanups.forEach((cleanup) => cleanup())
  }, [html, slug])

  return <div ref={container} className="prose" dangerouslySetInnerHTML={{ __html: html }} />
}
