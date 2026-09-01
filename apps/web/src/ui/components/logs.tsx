import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import type { LogsResponse, ProjectLogSource } from '../../shared/types.ts'
import { Badge } from './ui/badge.tsx'
import { Button } from './ui/button.tsx'
import { Input, Select } from './ui/field.tsx'
import { CopyButton } from './copy.tsx'
import { Empty, ErrorBox, Loading } from './shell-bits.tsx'
import { cn } from '../lib/utils.ts'

/** A line that may carry the service that produced it. */
interface ViewerLine {
  stream: 'stdout' | 'stderr'
  timestamp: string | null
  text: string
  service?: string
}

interface ViewerResponse extends Omit<LogsResponse, 'containerId' | 'name' | 'lines'> {
  lines: ViewerLine[]
  /** Present when the response covers several services. */
  sources?: ProjectLogSource[]
  ordered?: boolean
}

/** Six stable tones, picked by a hash so a service keeps its colour. */
const ORIGIN_TONES = [
  'text-accent',
  'text-info',
  'text-ok',
  'text-warn',
  'text-danger',
  'text-muted',
] as const

export function originTone(service: string): string {
  let hash = 0
  for (let index = 0; index < service.length; index += 1) {
    hash = (hash * 31 + service.charCodeAt(index)) | 0
  }
  return ORIGIN_TONES[Math.abs(hash) % ORIGIN_TONES.length]!
}

/**
 * Recent lines, a filter, and a copy button. Deliberately not a log platform:
 * for anything more, the container's own tooling is a better place to look.
 *
 * With `sources`, the same component reads a whole project: a selector narrows
 * to one service, a status strip reports the sources that could not be read,
 * and `showOrigin` puts the service name in front of every line. The selector
 * comes from the caller so it lists every service; the strip comes from the
 * response, so it reports what this particular read found.
 */
export function LogViewer({
  queryKey,
  load,
  className,
  sources,
  showOrigin = false,
  selectedService,
  onSelectService,
}: {
  queryKey: unknown[]
  load: (tail: number) => Promise<ViewerResponse>
  className?: string
  sources?: ProjectLogSource[]
  showOrigin?: boolean
  selectedService?: string | null
  onSelectService?: (service: string | null) => void
}) {
  const [tail, setTail] = useState(200)
  const [filter, setFilter] = useState('')
  const [follow, setFollow] = useState(false)

  const query = useQuery({
    queryKey: [...queryKey, tail],
    queryFn: () => load(tail),
    refetchInterval: follow ? 3000 : false,
  })

  const lines = useMemo(() => {
    const all = query.data?.lines ?? []
    if (filter.trim() === '') return all
    const needle = filter.toLowerCase()
    return all.filter((line) => line.text.toLowerCase().includes(needle))
  }, [query.data, filter])

  const asText = useMemo(
    () => lines.map((line) => (line.service ? `${line.service} | ${line.text}` : line.text)).join('\n'),
    [lines],
  )

  const gutter = showOrigin
    ? Math.min(Math.max(...lines.map((line) => line.service?.length ?? 0), 0), 18)
    : 0

  const reported = query.data?.sources ?? []
  const failed = reported.filter((source) => source.error !== null)
  const notRunning = reported.filter((source) => source.error === null && source.state !== 'running')
  const approximateOrder = query.data?.ordered === false

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        {sources && onSelectService ? (
          <Select
            value={selectedService ?? ''}
            onChange={(event) => onSelectService(event.target.value === '' ? null : event.target.value)}
            className="h-7 w-44"
            aria-label="Service"
          >
            <option value="">All services</option>
            {sources.map((source) => (
              <option key={source.containerId} value={source.service}>
                {source.service}
                {source.state === 'running' ? '' : ` (${source.state})`}
              </option>
            ))}
          </Select>
        ) : null}
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter lines"
          className="h-7 w-48"
          aria-label="Filter log lines"
        />
        <Select
          value={String(tail)}
          onChange={(event) => setTail(Number(event.target.value))}
          className="h-7 w-28"
          aria-label="Number of lines"
        >
          <option value="100">100 lines</option>
          <option value="200">200 lines</option>
          <option value="500">500 lines</option>
          <option value="1000">1000 lines</option>
        </Select>
        <Button
          size="sm"
          variant={follow ? 'primary' : 'default'}
          onClick={() => setFollow((value) => !value)}
          title="Refresh every 3 seconds"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', follow && 'animate-spin')} />
          {follow ? 'Following' : 'Follow'}
        </Button>
        <Button size="sm" onClick={() => void query.refetch()}>
          Reload
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <span className="text-xs text-subtle">{lines.length} lines</span>
          <CopyButton value={asText} label="Copy log" />
        </div>
      </div>

      {sources && (failed.length > 0 || notRunning.length > 0 || approximateOrder) ? (
        <div
          role="status"
          aria-label="Log sources"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-1.5 text-xs"
        >
          {failed.map((source) => (
            <span key={source.containerId} className="flex items-center gap-1.5">
              <Badge tone="danger">{source.service}</Badge>
              <span className="text-subtle">{source.error}</span>
            </span>
          ))}
          {notRunning.map((source) => (
            <span key={source.containerId} className="flex items-center gap-1.5">
              <Badge tone="warn">{source.service}</Badge>
              <span className="text-subtle">{source.state}</span>
            </span>
          ))}
          {approximateOrder ? (
            <span className="text-subtle">
              A source logs without timestamps, so ordering between services is approximate.
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto bg-surface-2/50 scroll-thin">
        {query.isPending ? <Loading label="Reading logs" /> : null}
        {query.error ? (
          <div className="p-3">
            <ErrorBox error={query.error} />
          </div>
        ) : null}
        {query.data && lines.length === 0 ? (
          <Empty title={filter ? 'No line matches the filter' : 'No output yet'} />
        ) : null}
        {lines.length > 0 ? (
          <pre className="p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap">
            {lines.map((line, index) => (
              <div
                key={index}
                className={line.stream === 'stderr' ? 'text-danger' : 'text-ink/90'}
              >
                {showOrigin && line.service ? (
                  <span className={cn('mr-2 inline-block', originTone(line.service))}>
                    {line.service.padEnd(gutter, ' ').slice(0, gutter)} |
                  </span>
                ) : null}
                {line.timestamp ? (
                  <span className="mr-2 text-subtle">{line.timestamp.slice(11, 19)}</span>
                ) : null}
                {line.text}
              </div>
            ))}
          </pre>
        ) : null}
      </div>
    </div>
  )
}
