import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { LiveEvent } from '../../shared/types.ts'

export type LiveState = 'connecting' | 'live' | 'offline'

/**
 * Docker's event stream, relayed by the server. The panel refetches on a real
 * change instead of polling; the short debounce keeps a `docker compose up`
 * from triggering a dozen refetches in a row.
 */
export function useLive(): { state: LiveState; last: LiveEvent | null } {
  const queryClient = useQueryClient()
  const [state, setState] = useState<LiveState>('connecting')
  const [last, setLast] = useState<LiveEvent | null>(null)

  useEffect(() => {
    const source = new EventSource('/api/events')
    let timer: ReturnType<typeof setTimeout> | null = null

    const refresh = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        void queryClient.invalidateQueries()
      }, 250)
    }

    const onEvent = (event: MessageEvent<string>) => {
      setState('live')
      try {
        setLast(JSON.parse(event.data) as LiveEvent)
      } catch {
        /* a keepalive is not JSON */
      }
      refresh()
    }

    source.addEventListener('hello', () => setState('live'))
    source.addEventListener('ping', () => setState('live'))
    for (const kind of ['container', 'network', 'bridge', 'health', 'project', 'config']) {
      source.addEventListener(kind, onEvent as EventListener)
    }
    source.onerror = () => setState('offline')
    source.onopen = () => setState('live')

    return () => {
      if (timer) clearTimeout(timer)
      source.close()
    }
  }, [queryClient])

  return { state, last }
}
