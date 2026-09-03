import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, User } from 'lucide-react'
import type { ActivityEvent, Task, TaskNote } from '../../../shared/task-types.ts'
import { Button } from '../ui/button.tsx'
import { ActivityTimeline } from '../entities/activity-timeline.tsx'
import { useFormat } from '../../lib/use-format.ts'
import { MarkdownEditor } from './markdown-editor.tsx'
import { MarkdownView } from './markdown-view.tsx'

export function TaskActivity({
  task,
  events,
  readOnly,
  onAdd,
  onEdit,
  onDelete,
}: {
  task: Task
  events: ActivityEvent[]
  readOnly?: boolean
  onAdd: (body: string) => Promise<unknown>
  onEdit: (note: TaskNote, body: string) => Promise<unknown>
  onDelete: (note: TaskNote) => void
}) {
  const { t } = useTranslation('tasks')
  const { relativeTime } = useFormat()
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editBody, setEditBody] = useState('')

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-medium text-ink">{t('detail.activity')}</h2>
      {task.notes.length === 0 && events.length === 0 ? (
        <p className="text-sm text-subtle">{t('detail.noActivityYet')}</p>
      ) : null}
      {task.notes.length > 0 ? (
        <ul className="space-y-3">
          {task.notes.map((note) => (
            <li key={note.id} className="rounded-md border border-line px-3 py-2">
              <div className="flex items-center gap-1 text-[11px] text-subtle">
                {note.actorKind === 'agent' ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}
                <span>{note.actor ?? t('detail.someone')}</span>
                <span>· {relativeTime(note.createdAt)}</span>
                {note.updatedAt ? <span>· {t('detail.edited')}</span> : null}
                {readOnly ? null : (
                  <span className="ml-auto flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => { setEditing(note.id); setEditBody(note.body) }}>{t('detail.editNote')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => onDelete(note)}>{t('detail.deleteNote')}</Button>
                  </span>
                )}
              </div>
              {editing === note.id ? (
                <div className="mt-2 space-y-2">
                  <MarkdownEditor value={editBody} onChange={setEditBody} />
                  <div className="flex gap-1">
                    <Button size="sm" variant="primary" onClick={() => void onEdit(note, editBody).then(() => setEditing(null))}>{t('dialog.save')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>{t('detail.cancel')}</Button>
                  </div>
                </div>
              ) : (
                <div className="mt-1"><MarkdownView source={note.body} /></div>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {readOnly ? null : (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (draft.trim() === '') return
            void onAdd(draft.trim()).then(() => setDraft(''))
          }}
        >
          <MarkdownEditor value={draft} onChange={setDraft} placeholder={t('detail.notePlaceholder')} />
          <Button size="sm" type="submit" disabled={draft.trim() === ''}>{t('detail.addNote')}</Button>
        </form>
      )}
      {events.length > 0 ? <ActivityTimeline events={events} compact emptyTitle={t('detail.noActivity')} /> : null}
    </section>
  )
}
