// The documentation site the panel serves.
//
// Offline by construction: the whole corpus is a JSON module the Vite plugin
// built from `docs/**`, so there is no CDN, no font host, no telemetry and no
// runtime Markdown dependency. The API reference is the one thing that talks to
// anything, and it talks only to this panel.
//
// Routing is the hash, so a deep link works from a static mount with no server
// rewrite beyond the SPA fallback the panel already does.

import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BookOpen, ChevronRight, ExternalLink, Moon, PanelLeft, Search, Sun } from 'lucide-react'
import bundle from 'virtual:portta-docs'
import type { DocsBundle } from './collect.ts'
import { ApiReference } from './api.tsx'
import '../ui/index.css'
import './style.css'

const docs = bundle as DocsBundle

/** `#/install#where-things-go` -> `{ slug: 'install', anchor: 'where-things-go' }`. */
function readRoute(): { slug: string; anchor: string | null } {
  const raw = window.location.hash.replace(/^#\/?/, '')
  const [slug = '', anchor] = raw.split('#')
  return { slug: slug || 'overview', anchor: anchor ?? null }
}

function useRoute() {
  const [route, setRoute] = useState(readRoute)
  useEffect(() => {
    const onChange = () => setRoute(readRoute())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const toggle = useCallback(() => {
    setDark((previous) => {
      const next = !previous
      document.documentElement.classList.toggle('dark', next)
      // The panel's own key: switching here switches there, without either
      // surface having to know about the other.
      try { localStorage.setItem('portta-theme', next ? 'dark' : 'light') } catch { /* private mode */ }
      return next
    })
  }, [])
  return { dark, toggle }
}

interface Hit {
  slug: string
  title: string
  section: string
  excerpt: string
}

/**
 * Search over the prebuilt payload.
 *
 * Substring, not fuzzy: the corpus is sixty-eight pages and the reader knows
 * roughly what it is called. A ranking that put a body mention above a title
 * match would be worse than no ranking at all.
 */
function search(query: string): Hit[] {
  const needle = query.trim().toLowerCase()
  if (needle.length < 2) return []
  const sectionOf = new Map<string, string>()
  for (const section of docs.sections) for (const page of section.pages) sectionOf.set(page.slug, section.title)

  const hits: Hit[] = []
  for (const slug of docs.order) {
    const page = docs.pages[slug]
    if (!page) continue
    const inTitle = page.title.toLowerCase().includes(needle)
    const at = page.search.indexOf(needle)
    if (!inTitle && at === -1) continue
    const excerpt = at === -1 ? '' : `…${page.search.slice(Math.max(0, at - 45), at + 75).trim()}…`
    hits.push({ slug, title: page.title, section: sectionOf.get(slug) ?? '', excerpt })
    if (hits.length >= 40) break
  }
  return hits.sort((a, b) => {
    const rank = (hit: Hit) => (hit.title.toLowerCase().includes(needle) ? 0 : 1)
    return rank(a) - rank(b)
  })
}

function Sidebar({ slug, onNavigate }: { slug: string; onNavigate: () => void }) {
  return (
    <nav className="flex h-full flex-col gap-5 overflow-y-auto scroll-thin px-4 py-5 text-sm">
      {docs.sections.map((section) => (
        <div key={section.title}>
          <p className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">
            {section.title}
          </p>
          <ul>
            {section.pages.map((page) => (
              <li key={page.slug}>
                <a
                  href={`#/${page.slug}`}
                  onClick={onNavigate}
                  aria-current={page.slug === slug ? 'page' : undefined}
                  className={`block truncate rounded-md px-2 py-1 ${
                    page.slug === slug
                      ? 'bg-accent/12 font-medium text-accent'
                      : 'text-muted hover:bg-surface-2 hover:text-ink'
                  }`}
                  title={page.summary || page.title}
                >
                  {page.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div>
        <p className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">Reference</p>
        <a
          href="#/api"
          onClick={onNavigate}
          aria-current={slug === 'api' ? 'page' : undefined}
          className={`block truncate rounded-md px-2 py-1 ${
            slug === 'api' ? 'bg-accent/12 font-medium text-accent' : 'text-muted hover:bg-surface-2 hover:text-ink'
          }`}
        >
          API reference
        </a>
      </div>
    </nav>
  )
}

function Contents({ headings }: { headings: DocsBundle['pages'][string]['headings'] }) {
  if (headings.length < 2) return null
  return (
    <aside className="hidden w-56 shrink-0 xl:block">
      <div className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto scroll-thin pr-2 text-sm">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">On this page</p>
        <ul className="space-y-1">
          {headings.map((heading) => (
            <li key={heading.id} style={{ paddingLeft: heading.level === 3 ? '0.75rem' : 0 }}>
              <a href={`#${heading.id}`} className="block truncate text-muted hover:text-accent" title={heading.text}>
                {heading.text}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  )
}

function Page({ slug }: { slug: string }) {
  const page = docs.pages[slug]
  const position = docs.order.indexOf(slug)
  const previous = position > 0 ? docs.pages[docs.order[position - 1]!] : undefined
  const next = position >= 0 && position < docs.order.length - 1 ? docs.pages[docs.order[position + 1]!] : undefined

  if (!page) {
    return (
      <div className="mx-auto max-w-2xl py-16 text-center">
        <p className="text-lg font-medium">No page called “{slug}”.</p>
        <a href="#/overview" className="mt-3 inline-block text-accent underline">Back to the overview</a>
      </div>
    )
  }

  return (
    <div className="flex gap-10">
      <article className="min-w-0 flex-1">
        {/*
          The HTML is the project's own documentation, rendered at build time by
          a markdown-it configured with `html: false` -- so a raw <script> in a
          Markdown file is escaped, not passed through, and nothing a user typed
          reaches here at all. If this component ever renders something a user
          supplied, it needs a sanitiser first.
        */}
        <div className="prose" dangerouslySetInnerHTML={{ __html: page.html }} />
        <footer className="mt-12 border-t border-line pt-5 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {previous ? (
              <a href={`#/${previous.slug}`} className="text-muted hover:text-accent">← {previous.title}</a>
            ) : <span />}
            {next ? (
              <a href={`#/${next.slug}`} className="text-muted hover:text-accent">{next.title} →</a>
            ) : <span />}
          </div>
          <p className="mt-4 text-xs text-subtle">
            Served from this panel’s image.{' '}
            <a
              className="underline hover:text-accent"
              href={`https://github.com/fabioassuncao/portta/blob/main/${page.source}`}
              target="_blank"
              rel="noreferrer"
            >
              {page.source} on GitHub <ExternalLink className="inline size-3" aria-hidden />
            </a>
          </p>
        </footer>
      </article>
      <Contents headings={page.headings} />
    </div>
  )
}

function App() {
  const route = useRoute()
  const { dark, toggle } = useTheme()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const main = useRef<HTMLElement>(null)
  const hits = useMemo(() => search(query), [query])

  // A deep link lands on the page first and the anchor second, because the
  // heading does not exist until the page has rendered.
  useEffect(() => {
    setQuery('')
    setOpen(false)
    main.current?.scrollTo({ top: 0 })
    if (!route.anchor) return
    const timer = setTimeout(() => {
      document.getElementById(route.anchor!)?.scrollIntoView({ block: 'start' })
    }, 0)
    return () => clearTimeout(timer)
  }, [route.slug, route.anchor])

  return (
    <div className="flex h-full flex-col bg-bg text-ink">
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink lg:hidden"
          aria-label="Toggle the navigation"
        >
          <PanelLeft className="size-4" aria-hidden />
        </button>
        <a href="#/overview" className="flex items-center gap-2 font-semibold">
          <BookOpen className="size-4 text-accent" aria-hidden />
          Portta docs
        </a>

        <div className="relative ml-auto w-full max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the documentation"
            aria-label="Search the documentation"
            className="w-full rounded-md border border-line bg-surface py-1.5 pl-8 pr-3 text-sm outline-none focus:border-accent"
          />
          {hits.length > 0 && (
            <ul className="absolute z-20 mt-1 max-h-96 w-full overflow-y-auto scroll-thin rounded-md border border-line bg-surface shadow-lg">
              {hits.map((hit) => (
                <li key={hit.slug}>
                  <a href={`#/${hit.slug}`} className="block px-3 py-2 hover:bg-surface-2">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      {hit.title}
                      <ChevronRight className="size-3 text-subtle" aria-hidden />
                      <span className="text-xs font-normal text-subtle">{hit.section}</span>
                    </span>
                    {hit.excerpt && <span className="mt-0.5 block truncate text-xs text-muted">{hit.excerpt}</span>}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>

        <a href="/" className="hidden rounded-md px-2 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-ink sm:block">
          Back to the panel
        </a>
        <button
          type="button"
          onClick={toggle}
          className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink"
          aria-label={dark ? 'Switch to the light theme' : 'Switch to the dark theme'}
        >
          {dark ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <div
          className={`w-64 shrink-0 border-r border-line bg-surface ${open ? 'absolute inset-y-0 left-0 top-12 z-10' : 'hidden'} lg:static lg:block`}
        >
          <Sidebar slug={route.slug} onNavigate={() => setOpen(false)} />
        </div>
        <main ref={main} className="min-w-0 flex-1 overflow-y-auto scroll-thin px-6 py-8 lg:px-10">
          <div className="mx-auto max-w-4xl">
            {route.slug === 'api' ? <ApiReference /> : <Page slug={route.slug} />}
          </div>
        </main>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
