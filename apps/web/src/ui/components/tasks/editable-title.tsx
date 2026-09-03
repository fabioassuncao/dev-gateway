import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isDefaultDraftTitle } from '../../lib/task-draft.ts'
import { cn } from '../../lib/utils.ts'

export function EditableTitle({
  value,
  draft,
  pending,
  error,
  disabled,
  autoFocus,
  onSave,
}: {
  value: string
  draft?: boolean
  pending?: boolean
  error?: string | null
  disabled?: boolean
  autoFocus?: boolean
  onSave: (title: string) => Promise<unknown> | unknown
}) {
  const { t } = useTranslation('tasks')
  const [editing, setEditing] = useState(Boolean(autoFocus && draft))
  const [draftTitle, setDraftTitle] = useState(value)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraftTitle(value) }, [value])
  useEffect(() => {
    if (editing) input.current?.focus()
  }, [editing])

  const display = draft && isDefaultDraftTitle(value) ? t('draft.placeholder') : value

  const confirm = async () => {
    const next = draftTitle.trim()
    setEditing(false)
    if (next === '' || next === value) {
      setDraftTitle(value)
      return
    }
    try {
      await onSave(next)
    } catch {
      setDraftTitle(value)
    }
  }

  if (editing && !disabled) {
    return (
      <div>
        <input
          ref={input}
          value={draftTitle}
          aria-label={t('dialog.title')}
          onChange={(event) => setDraftTitle(event.target.value)}
          onBlur={() => void confirm()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void confirm()
            }
            if (event.key === 'Escape') {
              setDraftTitle(value)
              setEditing(false)
            }
          }}
          className="w-full bg-transparent text-2xl font-semibold tracking-tight text-ink outline-none"
        />
        {pending ? <p className="mt-1 text-[11px] text-subtle">{t('save.saving')}</p> : null}
        {error ? <p className="mt-1 text-[11px] text-danger">{error}</p> : null}
      </div>
    )
  }

  return (
    <div>
      <h1>
        <button
          type="button"
          disabled={disabled}
          onClick={() => { setDraftTitle(value); setEditing(true) }}
          className={cn(
            'block w-full rounded-md text-left text-2xl font-semibold tracking-tight outline-none',
            'hover:bg-surface-2/60 focus-visible:ring-2 focus-visible:ring-accent/40',
            draft && isDefaultDraftTitle(value) ? 'text-subtle' : 'text-ink',
          )}
        >
          {display}
        </button>
      </h1>
      {pending ? <p className="mt-1 text-[11px] text-subtle">{t('save.saving')}</p> : null}
      {error ? <p className="mt-1 text-[11px] text-danger">{error}</p> : null}
    </div>
  )
}
