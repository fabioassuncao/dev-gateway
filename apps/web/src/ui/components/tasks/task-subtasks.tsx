import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Task, TaskSummary } from '../../../shared/task-types.ts'
import { Button } from '../ui/button.tsx'
import { Input } from '../ui/field.tsx'
import { TaskRow } from '../entities/task-row.tsx'
import { taskHref } from '../../lib/tasks.ts'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx'

export function TaskSubtasks({
  task,
  candidates,
  readOnly,
  onCreate,
  onLink,
  onUnlink,
}: {
  task: Task
  candidates: TaskSummary[]
  readOnly?: boolean
  onCreate: () => void
  onLink: (id: string) => void
  onUnlink: (id: string) => void
}) {
  const { t } = useTranslation('tasks')
  const [query, setQuery] = useState('')
  const done = task.subtasks.filter((entry) => entry.status === 'done').length
  const linkable = useMemo(
    () => candidates.filter((entry) =>
      entry.id !== task.id
      && entry.parentId !== task.id
      && !task.subtasks.some((child) => child.id === entry.id)
      && (query === '' || entry.title.toLowerCase().includes(query.toLowerCase()) || entry.id.includes(query))),
    [candidates, query, task],
  )

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-ink">{t('detail.subtasks', { done, total: task.subtasks.length })}</h2>
        {readOnly ? null : (
          <div className="flex gap-1">
            <Button size="sm" onClick={onCreate}>{t('detail.newSubtask')}</Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" variant="ghost">{t('detail.linkExisting')}</Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-2">
                <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('detail.searchTasks')} className="mb-2 h-7" />
                {linkable.length === 0 ? <p className="px-1 py-2 text-xs text-subtle">{t('detail.noLinkable')}</p> : linkable.slice(0, 12).map((entry) => (
                  <button key={entry.id} type="button" onClick={() => onLink(entry.id)} className="block w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-surface-2">
                    #{entry.id} {entry.title}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          </div>
        )}
      </div>
      {task.subtasks.length === 0 ? (
        <p className="text-sm text-subtle">{t('detail.noSubtasks')}</p>
      ) : (
        <ul className="divide-y divide-line/70 rounded-md border border-line">
          {task.subtasks.map((subtask) => (
            <li key={subtask.id}>
              <TaskRow
                task={subtask}
                href={taskHref(task.project, subtask.id)}
                compact
                actions={readOnly ? undefined : (
                  <Button size="sm" variant="ghost" onClick={() => onUnlink(subtask.id)}>{t('detail.unlinkSubtask')}</Button>
                )}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
