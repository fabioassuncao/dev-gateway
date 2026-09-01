import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import type { LogsResponse } from '../../shared/types.ts'
import { Button } from './ui/button.tsx'
import { Input, Select } from './ui/field.tsx'
import { CopyButton } from './copy.tsx'
import { Empty, ErrorBox, Loading } from './shell-bits.tsx'
import { cn } from '../lib/utils.ts'

/**
 * Recent lines, a filter, and a copy button. Deliberately not a log platform:
 * for anything more, the container's own tooling is a better place to look.
 */
export function LogViewer({
  queryKey,
  load,
  className,
}: {
  queryKey: unknown[]
  load: (tail: number) => Promise<LogsResponse>
  className?: string
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

  const asText = useMemo(() => lines.map((line) => line.text).join('\n'), [lines])

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
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
