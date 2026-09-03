import { useTranslation } from 'react-i18next'
import type { TaskSummary } from '../../../shared/task-types.ts'
import { Empty } from '../shell-bits.tsx'
import { nestTasks, taskHref } from '../../lib/tasks.ts'
import { TaskRow } from '../entities/task-row.tsx'

/** Tasks as rows, subtasks indented under their parent. */
export function TaskList({
  slug,
  tasks,
  compact = false,
  showProject = false,
  emptyTitle,
  emptyHint,
}: {
  slug?: string
  tasks: TaskSummary[]
  compact?: boolean
  showProject?: boolean
  emptyTitle?: string
  emptyHint?: string
}) {
  const { t } = useTranslation('tasks')
  if (tasks.length === 0) return <Empty title={emptyTitle ?? t('emptyList')} hint={emptyHint ?? t('emptyListHint')} />
  return (
    <div>
      {nestTasks(tasks).map(({ task, depth }) => (
        <TaskRow key={task.id} task={task} depth={depth} compact={compact} showProject={showProject} href={taskHref(slug ?? task.project, task.id)} />
      ))}
    </div>
  )
}
