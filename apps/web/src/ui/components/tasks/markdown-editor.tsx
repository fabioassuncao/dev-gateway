import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils.ts'
import { Button } from '../ui/button.tsx'
import { MarkdownView } from './markdown-view.tsx'

export function MarkdownEditor({
  value,
  onChange,
  onBlur,
  placeholder,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  placeholder?: string
  disabled?: boolean
}) {
  const { t } = useTranslation('tasks')
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')

  const wrap = (before: string, after = before) => {
    const area = document.querySelector<HTMLTextAreaElement>('[data-task-markdown]')
    if (!area) {
      onChange(`${value}${before}${after}`)
      return
    }
    const start = area.selectionStart
    const end = area.selectionEnd
    const selected = value.slice(start, end)
    const next = `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`
    onChange(next)
  }

  return (
    <div className="rounded-md border border-line">
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-2 py-1">
        <Button size="sm" variant={mode === 'edit' ? 'default' : 'ghost'} disabled={disabled} onClick={() => setMode('edit')}>{t('markdown.edit')}</Button>
        <Button size="sm" variant={mode === 'preview' ? 'default' : 'ghost'} disabled={disabled} onClick={() => setMode('preview')}>{t('markdown.preview')}</Button>
        {mode === 'edit' ? (
          <span className="ml-2 flex gap-0.5">
            <ToolbarButton disabled={disabled} onClick={() => wrap('**')} label="B" title={t('markdown.bold')} className="font-bold" />
            <ToolbarButton disabled={disabled} onClick={() => wrap('_')} label="I" title={t('markdown.italic')} className="italic" />
            <ToolbarButton disabled={disabled} onClick={() => wrap('`')} label="<>" title={t('markdown.code')} />
            <ToolbarButton disabled={disabled} onClick={() => wrap('\n- ', '')} label="•" title={t('markdown.list')} />
            <ToolbarButton disabled={disabled} onClick={() => wrap('\n- [ ] ', '')} label="☑" title={t('markdown.check')} />
          </span>
        ) : null}
      </div>
      {mode === 'preview' ? (
        <div className="min-h-32 px-3 py-2">
          {value.trim() === '' ? <p className="text-sm text-subtle">{placeholder}</p> : <MarkdownView source={value} />}
        </div>
      ) : (
        <textarea
          data-task-markdown
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          rows={10}
          className="block min-h-32 w-full resize-y bg-transparent px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-subtle"
        />
      )}
    </div>
  )
}

function ToolbarButton({ label, title, onClick, disabled, className }: { label: string; title: string; onClick: () => void; disabled?: boolean; className?: string }) {
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick} className={cn('rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-40', className)}>
      {label}
    </button>
  )
}
