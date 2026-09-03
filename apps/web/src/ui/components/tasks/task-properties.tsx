import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PopoverClose } from '../ui/popover.tsx'
import { Input } from '../ui/field.tsx'
import { TaskPriorityBadge, TaskStatusBadge } from '../entities/task-badges.tsx'
import { useTaskStatuses } from '../../i18n/use-task-statuses.ts'
import type { Project } from '../../../shared/types.ts'
import type { Task, TaskPriority, TaskStatus } from '../../../shared/task-types.ts'
import type { TaskBody } from '../../lib/api/index.ts'
import { PropertyChoice, PropertyMenu, PropertyRow } from './property-row.tsx'
import { TaskGitHubCard } from './task-github.tsx'

export function TaskProperties({
  task,
  project,
  readOnly,
  parentTitle,
  onPatch,
  github,
}: {
  task: Task
  project: Project | null
  readOnly?: boolean
  parentTitle?: string | null
  onPatch: (body: TaskBody) => void
  github: {
    configured: boolean
    link: (issue: string) => Promise<unknown>
    unlink: () => void
    publish: () => void
    sync: (resolve?: 'local' | 'remote') => void
  }
}) {
  const { t } = useTranslation('tasks')
  const { statusOptions, priorityOptions, priorityLabel } = useTaskStatuses()
  const [type, setType] = useState(task.type ?? '')
  const [labels, setLabels] = useState(task.labels.join(', '))
  const [assignee, setAssignee] = useState(task.assignee ?? '')
  const [agent, setAgent] = useState(task.agent ?? '')
  const [service, setService] = useState(task.service ?? '')
  const due = task.dueAt ? new Date(task.dueAt * 1000).toISOString().slice(0, 10) : ''

  return (
    <aside className="rounded-lg border border-line bg-surface px-3 py-2 lg:sticky lg:top-4">
      <dl>
        <PropertyMenu label={t('dialog.status')} value={<TaskStatusBadge status={task.status} />} disabled={readOnly}>
          {statusOptions.map((entry) => (
            <PopoverClose key={entry.value} asChild>
              <PropertyChoice selected={entry.value === task.status} onSelect={() => onPatch({ status: entry.value as TaskStatus })}>
                <TaskStatusBadge status={entry.value as TaskStatus} />
              </PropertyChoice>
            </PopoverClose>
          ))}
        </PropertyMenu>

        <PropertyMenu
          label={t('dialog.priority')}
          empty={!task.priority}
          value={task.priority ? <TaskPriorityBadge priority={task.priority} /> : t('priority.none')}
          disabled={readOnly}
        >
          {priorityOptions.map((entry) => (
            <PopoverClose key={entry.value || 'none'} asChild>
              <PropertyChoice selected={(entry.value || null) === (task.priority ?? '')} onSelect={() => onPatch({ priority: entry.value === '' ? null : entry.value as TaskPriority })}>
                {entry.label}
              </PropertyChoice>
            </PopoverClose>
          ))}
        </PropertyMenu>

        <PropertyMenu label={t('dialog.type')} empty={!task.type} value={task.type ?? t('detail.addType')} disabled={readOnly}>
          <form className="p-2" onSubmit={(event) => { event.preventDefault(); onPatch({ type: type.trim() === '' ? null : type.trim() }) }}>
            <Input value={type} onChange={(event) => setType(event.target.value)} placeholder={t('dialog.typePlaceholder')} />
          </form>
        </PropertyMenu>

        <PropertyMenu label={t('dialog.labels')} empty={task.labels.length === 0} value={task.labels.length > 0 ? task.labels.join(', ') : t('detail.addLabels')} disabled={readOnly}>
          <form className="p-2" onSubmit={(event) => { event.preventDefault(); onPatch({ labels: labels.split(',').map((entry) => entry.trim()).filter(Boolean) }) }}>
            <Input value={labels} onChange={(event) => setLabels(event.target.value)} placeholder={t('dialog.labelsPlaceholder')} />
          </form>
        </PropertyMenu>

        <PropertyMenu label={t('dialog.assignee')} empty={!task.assignee} value={task.assignee ?? t('detail.addAssignee')} disabled={readOnly}>
          <form className="p-2" onSubmit={(event) => { event.preventDefault(); onPatch({ assignee: assignee.trim() === '' ? null : assignee.trim() }) }}>
            <Input value={assignee} onChange={(event) => setAssignee(event.target.value)} />
          </form>
        </PropertyMenu>

        <PropertyMenu label={t('dialog.agent')} empty={!task.agent} value={task.agent ?? t('detail.addAgent')} disabled={readOnly}>
          <form className="p-2" onSubmit={(event) => { event.preventDefault(); onPatch({ agent: agent.trim() === '' ? null : agent.trim() }) }}>
            <Input value={agent} onChange={(event) => setAgent(event.target.value)} placeholder="claude-code" />
          </form>
        </PropertyMenu>

        <PropertyMenu
          label={t('dialog.due')}
          empty={!task.dueAt}
          value={task.dueAt ? new Date(task.dueAt * 1000).toLocaleDateString() : t('detail.addDue')}
          disabled={readOnly}
        >
          <div className="p-2">
            <Input
              type="date"
              value={due}
              onChange={(event) => {
                const value = event.target.value
                onPatch({ dueAt: value === '' ? null : Math.floor(new Date(`${value}T00:00:00`).getTime() / 1000) })
              }}
            />
          </div>
        </PropertyMenu>

        <PropertyRow label={t('dialog.parent')} empty={!task.parentId}>
          {task.parentId ? (
            <a className="text-sm text-accent hover:underline" href={`#/projects/${encodeURIComponent(task.project)}/tasks/${encodeURIComponent(task.parentId)}`}>
              {parentTitle ?? `#${task.parentId}`}
            </a>
          ) : (
            <span className="text-sm text-subtle">{t('detail.noParent')}</span>
          )}
        </PropertyRow>

        <PropertyMenu
          label={t('dialog.repository')}
          empty={!task.repository}
          value={task.repository?.name ?? t('dialog.wholeProject')}
          disabled={readOnly}
        >
          <PopoverClose asChild>
            <PropertyChoice selected={!task.repository} onSelect={() => onPatch({ repositoryId: null })}>{t('dialog.wholeProject')}</PropertyChoice>
          </PopoverClose>
          {(project?.repositories ?? []).map((repository) => (
            <PopoverClose key={repository.id} asChild>
              <PropertyChoice selected={task.repository?.id === repository.id} onSelect={() => onPatch({ repositoryId: repository.id })}>
                {repository.name}
              </PropertyChoice>
            </PopoverClose>
          ))}
        </PropertyMenu>

        <PropertyMenu
          label={t('dialog.environment')}
          empty={!task.environment}
          value={task.environment ?? t('dialog.noEnvironment')}
          disabled={readOnly}
        >
          <PopoverClose asChild>
            <PropertyChoice selected={!task.environment} onSelect={() => onPatch({ environment: null })}>{t('dialog.noEnvironment')}</PropertyChoice>
          </PopoverClose>
          {(project?.environments ?? []).map((entry) => (
            <PopoverClose key={entry.environment} asChild>
              <PropertyChoice selected={task.environment === entry.environment} onSelect={() => onPatch({ environment: entry.environment })}>
                {entry.environment}
              </PropertyChoice>
            </PopoverClose>
          ))}
        </PropertyMenu>

        <PropertyMenu label={t('dialog.service')} empty={!task.service} value={task.service ?? t('detail.addService')} disabled={readOnly}>
          <form className="p-2" onSubmit={(event) => { event.preventDefault(); onPatch({ service: service.trim() === '' ? null : service.trim() }) }}>
            <Input value={service} onChange={(event) => setService(event.target.value)} placeholder="api" />
          </form>
        </PropertyMenu>
      </dl>
      <div className="mt-3 border-t border-line pt-2">
        <TaskGitHubCard task={task} readOnly={readOnly} {...github} />
      </div>
    </aside>
  )
}
