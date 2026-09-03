import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MarkdownEditor } from './markdown-editor.tsx'
import { MarkdownView } from './markdown-view.tsx'

export function TaskDescription({
  value,
  disabled,
  pending,
  onSave,
}: {
  value: string | null
  disabled?: boolean
  pending?: boolean
  onSave: (description: string | null) => Promise<unknown> | unknown
}) {
  const { t } = useTranslation('tasks')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')

  useEffect(() => { setDraft(value ?? '') }, [value])

  const commit = async () => {
    const next = draft.trim() === '' ? null : draft
    setEditing(false)
    if (next === (value ?? null) && draft === (value ?? '')) return
    await onSave(next)
  }

  if (editing && !disabled) {
    return (
      <section>
        <MarkdownEditor
          value={draft}
          disabled={disabled}
          placeholder={t('detail.addDescription')}
          onChange={setDraft}
          onBlur={() => void commit()}
        />
        {pending ? <p className="mt-1 text-[11px] text-subtle">{t('save.saving')}</p> : null}
      </section>
    )
  }

  return (
    <section>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setEditing(true)}
        className="block w-full rounded-md text-left outline-none hover:bg-surface-2/40 focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {value ? (
          <MarkdownView source={value} />
        ) : (
          <p className="py-2 text-sm text-subtle">{t('detail.addDescription')}</p>
        )}
      </button>
    </section>
  )
}
