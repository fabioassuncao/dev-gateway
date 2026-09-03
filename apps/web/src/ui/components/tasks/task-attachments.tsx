import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, ImageIcon, Loader2, Paperclip, Trash2, Upload } from 'lucide-react'
import type { TaskAttachment } from '../../../shared/task-types.ts'
import { Button } from '../ui/button.tsx'
import { ConfirmDialog } from '../ui/confirm-dialog.tsx'
import { useToast } from '../ui/toast.tsx'
import { useFormat } from '../../lib/use-format.ts'
import { cn } from '../../lib/utils.ts'

/** Mirrors ATTACHMENT_LIMITS in src/server/core/attachments.ts. */
const MAX_MB = 10

const ICON = {
  image: ImageIcon,
  pdf: FileText,
  text: FileText,
  file: Paperclip,
} as const

/**
 * The files that belong to a task: the screenshot of the bug, the log that
 * proves it, the JSON the API actually returned.
 *
 * Three ways in, because all three are how people actually attach things: a
 * file picker, a drop onto the panel, and a paste straight from the clipboard
 * — which is what a screenshot is, and the one that saves a round trip through
 * the filesystem. Removal is confirmed by name, because the bytes are gone.
 */
export function TaskAttachments({
  attachments,
  readOnly = false,
  busy = false,
  onUpload,
  onRemove,
}: {
  attachments: readonly TaskAttachment[]
  readOnly?: boolean
  busy?: boolean
  onUpload: (files: File[]) => void
  onRemove: (attachment: TaskAttachment) => void
}) {
  const { t } = useTranslation('tasks', { keyPrefix: 'attachments' })
  const { bytes, relativeTime } = useFormat()
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const region = useRef<HTMLDivElement>(null)
  const [over, setOver] = useState(false)
  const [pending, setPending] = useState<TaskAttachment | null>(null)

  // A screenshot is on the clipboard, not on disk. Pasting one anywhere in
  // this section attaches it, which is the shortest path there is.
  useEffect(() => {
    const element = region.current
    if (!element || readOnly) return
    const onPaste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.files ?? [])]
      if (files.length === 0) return
      event.preventDefault()
      onUpload(files.map((file) => (file.name ? file : renamed(file, t('pasted', { time: Date.now() })))))
    }
    element.addEventListener('paste', onPaste as EventListener)
    return () => element.removeEventListener('paste', onPaste as EventListener)
  }, [onUpload, readOnly, t])

  return (
    <section
      ref={region}
      // Focusable so a paste lands here without a click first.
      tabIndex={readOnly ? undefined : 0}
      onDragOver={(event) => {
        if (readOnly) return
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        if (readOnly) return
        event.preventDefault()
        setOver(false)
        const files = [...event.dataTransfer.files]
        if (files.length > 0) onUpload(files)
      }}
      className={cn(
        'space-y-2 rounded-md outline-none transition-colors',
        over && 'ring-2 ring-accent ring-offset-2 ring-offset-bg',
        'focus-visible:ring-2 focus-visible:ring-accent',
      )}
    >
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium text-ink">{t('title', { count: attachments.length })}</h2>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-subtle" aria-hidden /> : null}
        {!readOnly ? (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => input.current?.click()}>
            <Upload className="h-3.5 w-3.5" />
            {t('add')}
          </Button>
        ) : null}
        <input
          ref={input}
          type="file"
          multiple
          className="sr-only"
          aria-label={t('add')}
          onChange={(event) => {
            const files = [...(event.target.files ?? [])]
            if (files.length > 0) onUpload(files)
            event.target.value = ''
          }}
        />
      </div>

      {attachments.length === 0 ? (
        <p className={cn('rounded-md border border-dashed px-3 py-4 text-center text-xs', over ? 'border-accent text-accent' : 'border-line text-subtle')}>
          {over ? t('dropHere') : `${t('empty')}. ${t('emptyHint', { max: MAX_MB })}`}
        </p>
      ) : (
        <ul className="divide-y divide-line/70 overflow-hidden rounded-md border border-line">
          {attachments.map((attachment) => {
            const Icon = ICON[attachment.kind]
            return (
              <li key={attachment.id} className="group flex min-w-0 items-center gap-2.5 px-3 py-2">
                {attachment.kind === 'image' ? (
                  <img
                    src={attachment.downloadUrl}
                    alt={t('preview', { name: attachment.filename })}
                    className="h-8 w-8 shrink-0 rounded border border-line object-cover"
                    loading="lazy"
                  />
                ) : (
                  <Icon className="h-4 w-4 shrink-0 text-subtle" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <a
                    className="block truncate text-sm text-ink underline-offset-2 hover:text-accent hover:underline"
                    href={attachment.downloadUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    title={t('openFile', { name: attachment.filename })}
                  >
                    {attachment.filename}
                  </a>
                  <span className="text-[11px] text-subtle">
                    {bytes(attachment.sizeBytes)} · {t('byOn', { actor: attachment.actor ?? t('unknownActor'), time: relativeTime(attachment.createdAt) })}
                  </span>
                </div>
                {!readOnly ? (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="row-actions"
                    aria-label={t('removeTitle', { name: attachment.filename })}
                    onClick={() => setPending(attachment)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => { if (!open) setPending(null) }}
        title={pending ? t('removeTitle', { name: pending.filename }) : ''}
        impact={t('removeImpact')}
        confirmLabel={t('remove')}
        onConfirm={() => {
          if (!pending) return
          onRemove(pending)
          toast.push({ tone: 'ok', duration: 2500, title: t('removed', { name: pending.filename }) })
          setPending(null)
        }}
      />
    </section>
  )
}

/** A pasted screenshot arrives as `image.png` or as nothing; give it a name. */
function renamed(file: File, name: string): File {
  const extension = file.type.split('/')[1] ?? 'png'
  return new File([file], `${name}.${extension}`, { type: file.type })
}
