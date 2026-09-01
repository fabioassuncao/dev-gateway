import { useTranslation } from 'react-i18next'
import { Check, Copy, ExternalLink } from 'lucide-react'
import { Button } from './ui/button.tsx'
import { useCopy } from '../lib/clipboard.ts'
import { cn } from '../lib/utils.ts'

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const { t } = useTranslation('common')
  const { copied, copy } = useCopy()
  const done = copied === value
  const copyLabel = label ?? t('copy')
  return (
    <Button
      variant="ghost"
      size="icon"
      title={done ? t('copied') : copyLabel}
      aria-label={done ? t('copied') : copyLabel}
      onClick={() => copy(value)}
    >
      {done ? <Check className="h-3.5 w-3.5 text-ok" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  )
}

export function Mono({ value, className }: { value: string; className?: string }) {
  return <span className={cn('font-mono text-xs text-muted', className)}>{value}</span>
}

/** A copyable, openable address. Used everywhere a URL appears. */
export function AddressLine({
  value,
  href,
  className,
}: {
  value: string
  href?: string
  className?: string
}) {
  const { t } = useTranslation('common')
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-0.5', className)}>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="truncate font-mono text-xs text-accent hover:underline"
        >
          {value}
        </a>
      ) : (
        <span className="truncate font-mono text-xs text-ink">{value}</span>
      )}
      <CopyButton value={value} />
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="rounded p-1 text-subtle hover:bg-surface-2 hover:text-ink"
          title={t('open')}
          aria-label={t('open')}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      ) : null}
    </span>
  )
}
