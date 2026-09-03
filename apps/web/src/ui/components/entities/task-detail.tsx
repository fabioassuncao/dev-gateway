import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, ExternalLink, GitCommitHorizontal, User } from 'lucide-react'
import type { Session, Task, TaskStatus, TaskSummary } from '../../../shared/task-types.ts'
import type { ActivityEvent } from '../../../shared/task-types.ts'
import { Badge } from '../ui/badge.tsx'
import { Button } from '../ui/button.tsx'
import { Card, CardBody, CardHeader } from '../ui/card.tsx'
import { Input, Select } from '../ui/field.tsx'
import { Empty } from '../shell-bits.tsx'
import { useTaskStatuses } from '../../i18n/use-task-statuses.ts'
import { syncTone } from '../../lib/task-presentation.ts'
import { taskHref } from '../../lib/tasks.ts'
import { useFormat } from '../../lib/use-format.ts'
import { TaskPriorityBadge, TaskWorker } from './task-badges.tsx'
import { TaskRow } from './task-row.tsx'
import { SessionRow } from './session-row.tsx'
import { ActivityTimeline } from './activity-timeline.tsx'

export interface TaskDetailActions {
  setStatus: (status: TaskStatus) => void
  start: () => void
  finish: (close: boolean) => void
  addNote: (body: string) => Promise<unknown>
  edit: () => void
  newSubtask: () => void
  remove: () => void
  setEnvironments: (environments: string[]) => void
  github: {
    link: (issue: string) => Promise<unknown>
    unlink: () => void
    publish: () => void
    sync: (resolve?: 'local' | 'remote') => void
    comment: (body: string) => Promise<unknown>
  }
}

/** The whole of one task, laid out so a person can review what happened and steer it. */
export function TaskDetail({
  task,
  sessions,
  events,
  environmentChoices,
  actions,
  readOnly = false,
  githubConfigured = true,
}: {
  task: Task
  sessions: Session[]
  events: ActivityEvent[]
  /** Environments of the project, offered for a manual link. */
  environmentChoices: string[]
  actions: TaskDetailActions
  readOnly?: boolean
  githubConfigured?: boolean
}) {
  const { t } = useTranslation('tasks')
  const { t: tc } = useTranslation('common')
  const { statusOptions } = useTaskStatuses()
  const { relativeTime } = useFormat()
  const [note, setNote] = useState('')
  const [issueRef, setIssueRef] = useState('')
  const [comment, setComment] = useState('')
  const [linking, setLinking] = useState(false)
  const [environmentToLink, setEnvironmentToLink] = useState('')

  const commits = sessions.flatMap((session) => session.commits.map((commit) => ({ ...commit, session })))
  const activeSessions = sessions.filter((session) => session.status === 'active')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={task.status} disabled={readOnly} onChange={(event) => actions.setStatus(event.target.value as TaskStatus)} aria-label={t('detail.status')} className="h-8 w-40">
          {statusOptions.map((entry) => (
            <option key={entry.value} value={entry.value}>{entry.label}</option>
          ))}
        </Select>
        <TaskPriorityBadge priority={task.priority} />
        {task.type ? <Badge tone="neutral">{task.type}</Badge> : null}
        {task.labels.map((label) => <Badge key={label} tone="outline">{label}</Badge>)}
        <TaskWorker task={task} className="inline-flex items-center gap-1 text-xs text-muted" />
        {task.repository ? (
          <a className="text-xs text-muted underline-offset-2 hover:text-accent hover:underline" href={`#/projects/${encodeURIComponent(task.project)}/repositories/${encodeURIComponent(task.repository.id)}`}>
            {t('detail.repository')}: {task.repository.name}
          </a>
        ) : (
          <span className="text-xs text-subtle">{t('detail.wholeProject')}</span>
        )}
        {task.environment ? (
          <a className="font-mono text-xs text-muted underline-offset-2 hover:text-accent hover:underline" href={`#/environments/${encodeURIComponent(task.environment)}`}>{task.environment}</a>
        ) : null}
        {task.service ? <Badge tone="outline">{task.service}</Badge> : null}
        <span className="ml-auto flex flex-wrap gap-1">
          {task.status !== 'in_progress' && task.status !== 'done' ? (
            <Button size="sm" variant="primary" disabled={readOnly} onClick={actions.start}>{t('detail.start')}</Button>
          ) : null}
          {task.status === 'in_progress' ? (
            <Button size="sm" variant="primary" disabled={readOnly} onClick={() => actions.setStatus('review')}>{t('detail.sendToReview')}</Button>
          ) : null}
          {task.status !== 'done' ? (
            <Button size="sm" disabled={readOnly} onClick={() => actions.finish(Boolean(task.github))}>{t('detail.finish')}</Button>
          ) : null}
          <Button size="sm" disabled={readOnly} onClick={actions.edit}>{t('detail.edit')}</Button>
          <Button size="sm" variant="ghost" disabled={readOnly} onClick={actions.remove}>{tc('delete')}</Button>
        </span>
      </div>

      <GitHubSection task={task} readOnly={readOnly} configured={githubConfigured} actions={actions.github} issueRef={issueRef} setIssueRef={setIssueRef} linking={linking} setLinking={setLinking} comment={comment} setComment={setComment} />

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('detail.description')} />
          <CardBody>
            {task.description ? (
              <pre className="whitespace-pre-wrap font-sans text-sm text-ink">{task.description}</pre>
            ) : (
              <p className="text-xs text-subtle">{t('detail.noDescription')}</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={t('detail.subtasks', { done: task.subtasks.filter((entry) => entry.status === 'done').length, total: task.subtasks.length })}
            actions={<Button size="sm" disabled={readOnly} onClick={actions.newSubtask}>{t('detail.newSubtask')}</Button>}
          />
          {task.subtasks.length === 0 ? (
            <Empty title={t('detail.noSubtasks')} hint={t('detail.noSubtasksHint')} />
          ) : (
            task.subtasks.map((subtask: TaskSummary) => <TaskRow key={subtask.id} task={subtask} href={taskHref(task.project, subtask.id)} compact />)
          )}
        </Card>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title={t('detail.sessions', { count: activeSessions.length })} />
          {sessions.length === 0 ? (
            <Empty title={t('detail.noSessions')} hint={t('detail.noSessionsHint', { id: task.id })} />
          ) : (
            sessions.map((session) => <SessionRow key={session.id} session={session} />)
          )}
        </Card>

        <Card>
          <CardHeader title={t('detail.commits', { count: commits.length })} />
          {commits.length === 0 ? (
            <Empty title={t('detail.noCommits')} />
          ) : (
            <ul className="divide-y divide-line/70">
              {commits.map((commit) => (
                <li key={`${commit.session.id}-${commit.sha}`} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                  <GitCommitHorizontal className="h-3.5 w-3.5 text-subtle" aria-hidden />
                  <span className="font-mono text-xs text-subtle">{commit.sha.slice(0, 7)}</span>
                  <span className="min-w-0 truncate">{commit.subject}</span>
                  <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-subtle">
                    {commit.session.actorKind === 'agent' ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}
                    {commit.session.agent ?? commit.session.actor} · {relativeTime(commit.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title={t('detail.environments', { count: task.environments.length })}
            actions={
              environmentChoices.length > 0 ? (
                <span className="flex items-center gap-1">
                  <Select value={environmentToLink} onChange={(event) => setEnvironmentToLink(event.target.value)} className="h-7 w-40" aria-label={t('detail.linkEnvironment')}>
                    <option value="">{t('detail.linkEnvironment')}</option>
                    {environmentChoices.map((name) => <option key={name} value={name}>{name}</option>)}
                  </Select>
                  <Button size="sm" disabled={readOnly || environmentToLink === ''} onClick={() => {
                    actions.setEnvironments([...task.environments.filter((entry) => entry.source === 'manual').map((entry) => entry.environment), environmentToLink])
                    setEnvironmentToLink('')
                  }}>{tc('attach')}</Button>
                </span>
              ) : null
            }
          />
          {task.environments.length === 0 ? (
            <Empty title={t('detail.noEnvironments')} hint={t('detail.noEnvironmentsHint', { id: task.id })} />
          ) : (
            task.environments.map((link) => (
              <div key={link.environment} className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2 text-sm last:border-b-0">
                <a className="font-medium underline-offset-2 hover:text-accent hover:underline" href={link.panelUrl}>{link.environment}</a>
                <Badge tone={link.running ? 'ok' : 'outline'}>{t('detail.running', { running: link.runningCount, total: link.serviceCount })}</Badge>
                {link.unhealthyCount > 0 ? <Badge tone="danger">{t('detail.unhealthy', { count: link.unhealthyCount })}</Badge> : null}
                {link.branch ? <span className="font-mono text-[11px] text-subtle">{link.branch}</span> : null}
                <span className="text-[11px] text-subtle">{link.reason}</span>
                {link.urls.slice(0, 2).map((url) => (
                  <a key={url.url} className="inline-flex items-center gap-0.5 font-mono text-[11px] text-muted hover:text-accent" href={url.url} target="_blank" rel="noreferrer noopener">
                    {url.url.replace(/^https?:\/\//, '')} <ExternalLink className="h-3 w-3" />
                  </a>
                ))}
                <a className="ml-auto text-[11px] text-accent hover:underline" href={`${link.panelUrl}/logs`}>{t('detail.logs')}</a>
              </div>
            ))
          )}
        </Card>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('detail.notes', { count: task.notes.length })} />
          {task.notes.length === 0 ? (
            <Empty title={t('detail.noNotes')} />
          ) : (
            <ul className="divide-y divide-line/70">
              {task.notes.map((entry) => (
                <li key={entry.id} className="px-4 py-2 text-sm">
                  <div className="flex items-center gap-1 text-[11px] text-subtle">
                    {entry.actorKind === 'agent' ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}
                    <span>{entry.actor ?? t('detail.someone')}</span>
                    <span>· {relativeTime(entry.createdAt)}</span>
                  </div>
                  <pre className="mt-0.5 whitespace-pre-wrap font-sans text-sm text-ink">{entry.body}</pre>
                </li>
              ))}
            </ul>
          )}
          <form
            className="flex gap-2 border-t border-line px-4 py-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (note.trim() === '') return
              void actions.addNote(note.trim()).then(() => setNote(''))
            }}
          >
            <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder={t('detail.notePlaceholder')} aria-label={t('detail.notePlaceholder')} disabled={readOnly} className="h-8" />
            <Button size="sm" type="submit" disabled={readOnly || note.trim() === ''}>{t('detail.addNote')}</Button>
          </form>
        </Card>

        <Card>
          <CardHeader title={t('detail.activity')} />
          <ActivityTimeline events={events} compact emptyTitle={t('detail.noActivity')} />
        </Card>
      </div>
    </div>
  )
}

function GitHubSection({
  task, readOnly, configured, actions, issueRef, setIssueRef, linking, setLinking, comment, setComment,
}: {
  task: Task
  readOnly: boolean
  configured: boolean
  actions: TaskDetailActions['github']
  issueRef: string
  setIssueRef: (value: string) => void
  linking: boolean
  setLinking: (value: boolean) => void
  comment: string
  setComment: (value: string) => void
}) {
  const { t } = useTranslation('tasks')
  const github = task.github
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface-2/40 px-3 py-2 text-sm" role="group" aria-label={t('github.section')}>
      {github ? (
        <>
          <a className="inline-flex items-center gap-1 font-mono text-xs underline-offset-2 hover:text-accent hover:underline" href={github.htmlUrl} target="_blank" rel="noreferrer noopener">
            {github.repository}#{github.number} <ExternalLink className="h-3 w-3" />
          </a>
          <Badge tone={github.state === 'open' ? 'ok' : 'neutral'}>{t(`github.state.${github.state}`)}</Badge>
          <Badge tone={syncTone(github.syncState)}>{t(`sync.${github.syncState}`)}</Badge>
          {github.lastSyncedAt ? <span className="text-[11px] text-subtle">{t('github.lastSynced', { time: relativeSeconds(github.lastSyncedAt) })}</span> : null}
          {github.lastError ? <span className="text-[11px] text-danger">{github.lastError}</span> : null}
          {github.metadataSource === 'labels' ? <span className="text-[11px] text-subtle" title={t('status.fromLabel')}>{t('github.viaLabels')}</span> : null}
          {github.syncState === 'conflict' && github.remote ? (
            <span className="basis-full text-xs text-muted">
              {t('github.conflictExplained', { title: github.remote.title, status: github.remote.status ?? '—', assignee: github.remote.assignee ?? '—' })}
            </span>
          ) : null}
          <span className="ml-auto flex flex-wrap gap-1">
            {github.syncState === 'conflict' ? (
              <>
                <Button size="sm" disabled={readOnly} onClick={() => actions.sync('local')}>{t('github.keepLocal')}</Button>
                <Button size="sm" disabled={readOnly} onClick={() => actions.sync('remote')}>{t('github.takeRemote')}</Button>
              </>
            ) : (
              <Button size="sm" disabled={readOnly || !configured} onClick={() => actions.sync()}>{t('github.sync')}</Button>
            )}
            <Button size="sm" variant="ghost" disabled={readOnly} onClick={actions.unlink}>{t('github.unlink')}</Button>
          </span>
          <form
            className="flex basis-full gap-2 pt-1"
            onSubmit={(event) => {
              event.preventDefault()
              if (comment.trim() === '') return
              void actions.comment(comment.trim()).then(() => setComment(''))
            }}
          >
            <Input value={comment} onChange={(event) => setComment(event.target.value)} placeholder={t('github.commentPlaceholder')} aria-label={t('github.commentPlaceholder')} disabled={readOnly || !configured} className="h-8" />
            <Button size="sm" type="submit" disabled={readOnly || !configured || comment.trim() === ''}>{t('github.comment')}</Button>
          </form>
        </>
      ) : (
        <>
          <span className="text-xs text-muted">{t('github.notBound')}</span>
          <span className="ml-auto flex flex-wrap items-center gap-1">
            {linking ? (
              <form
                className="flex gap-1"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (issueRef.trim() === '') return
                  void actions.link(issueRef.trim()).then(() => { setIssueRef(''); setLinking(false) })
                }}
              >
                <Input value={issueRef} onChange={(event) => setIssueRef(event.target.value)} placeholder="owner/repo#42" aria-label={t('github.issueRef')} className="h-8 w-44" />
                <Button size="sm" type="submit" disabled={issueRef.trim() === ''}>{t('github.link')}</Button>
              </form>
            ) : (
              <Button size="sm" disabled={readOnly || !configured} onClick={() => setLinking(true)}>{t('github.link')}</Button>
            )}
            <Button size="sm" disabled={readOnly || !configured || !task.repository} title={!task.repository ? t('github.publishNeedsRepository') : undefined} onClick={actions.publish}>{t('github.publish')}</Button>
          </span>
        </>
      )}
    </div>
  )
}

function relativeSeconds(epoch: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - epoch)
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}
