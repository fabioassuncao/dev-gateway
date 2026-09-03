import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText } from 'lucide-react'
import type { InstructionFile } from '../../../shared/types.ts'
import { useFormat } from '../../lib/use-format.ts'
import { cn } from '../../lib/utils.ts'
import { Badge } from '../ui/badge.tsx'
import { Empty } from '../shell-bits.tsx'

/**
 * The files an agent reads before it works, as the host scan found them: the
 * list, and the content of the one selected. Markdown is shown as text: the
 * point is to read what the agent reads, not to render it.
 */
export function InstructionsPanel({
  files,
  compact = false,
  className,
}: {
  files: InstructionFile[]
  /** The list alone, for an overview; no viewer. */
  compact?: boolean
  className?: string
}) {
  const { t } = useTranslation('repositories', { keyPrefix: 'instructions' })
  const { bytes, relativeTime } = useFormat()
  const [selected, setSelected] = useState<string | null>(files[0]?.path ?? null)
  const current = files.find((file) => file.path === selected) ?? files[0] ?? null

  if (files.length === 0) {
    return <Empty title={t('empty')} hint={compact ? undefined : t('emptyHint')} />
  }

  const list = (
    <ul className={cn('divide-y divide-line/70', !compact && 'md:w-72 md:shrink-0 md:border-r md:border-line')}>
      {files.map((file) => {
        const active = !compact && current?.path === file.path
        const body = (
          <>
            <span className="flex min-w-0 items-center gap-1.5">
              <FileText className="h-3.5 w-3.5 shrink-0 text-subtle" />
              <span className="truncate font-mono text-xs text-ink">{file.path}</span>
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-subtle">
              <Badge tone="outline">{t(`audience.${file.audience}`, { defaultValue: file.audience })}</Badge>
              <span>{bytes(file.sizeBytes)}</span>
              <span>{relativeTime(file.modifiedAt)}</span>
              {file.dirty ? <Badge tone="warn">{t('dirty')}</Badge> : null}
              {file.truncated ? <Badge tone="neutral">{t('truncated')}</Badge> : null}
            </span>
          </>
        )
        return (
          <li key={file.path}>
            {compact ? (
              <div className="px-4 py-2">{body}</div>
            ) : (
              <button
                type="button"
                aria-pressed={active}
                onClick={() => setSelected(file.path)}
                className={cn('block w-full px-4 py-2 text-left hover:bg-surface-2/60', active && 'bg-surface-2')}
              >
                {body}
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )

  if (compact) return <div className={className}>{list}</div>

  return (
    <div className={cn('flex flex-col md:flex-row', className)}>
      {list}
      <div className="min-w-0 flex-1">
        {current ? (
          current.content === null ? (
            <Empty title={t('overBound', { size: bytes(current.sizeBytes) })} hint={t('overBoundHint')} />
          ) : (
            <pre
              aria-label={current.path}
              className="max-h-[70vh] overflow-auto p-4 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink/90 scroll-thin"
            >
              {current.content}
            </pre>
          )
        ) : null}
      </div>
    </div>
  )
}
