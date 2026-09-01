import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api.ts'
import type { Issue, IssuePriority, WorkflowStatus } from '../../shared/types.ts'
import { Badge } from './ui/badge.tsx'
import { Button } from './ui/button.tsx'
import { Dialog } from './ui/dialog.tsx'
import { Input, Select } from './ui/field.tsx'
import { ErrorBox } from './shell-bits.tsx'
import { useIssueStatuses } from '../i18n/use-issue-statuses.ts'

export function IssueDialog(
  props:
    | { mode: 'create'; repositories: string[]; open: boolean; onOpenChange: (open: boolean) => void }
    | { mode: 'edit'; issue: Issue; open: boolean; onOpenChange: (open: boolean) => void },
) {
  const { t } = useTranslation('issues')
  const { statusOptions, priorityOptions } = useIssueStatuses()
  const queryClient = useQueryClient()
  const editing = props.mode === 'edit' ? props.issue : null

  const [repository, setRepository] = useState(
    props.mode === 'create' ? (props.repositories[0] ?? '') : props.issue.repository,
  )
  const [title, setTitle] = useState(editing?.title ?? '')
  const [body, setBody] = useState(editing?.body ?? '')
  const [status, setStatus] = useState<WorkflowStatus | ''>(editing?.status ?? '')
  const [priority, setPriority] = useState<IssuePriority | ''>(editing?.priority ?? '')
  const [assignees, setAssignees] = useState((editing?.assignees ?? []).join(', '))

  const submit = useMutation({
    mutationFn: () => {
      const people = assignees
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '')

      if (props.mode === 'create') {
        return api.createIssue(repository, {
          title: title.trim(),
          ...(body.trim() === '' ? {} : { body: body.trim() }),
          ...(status === '' ? {} : { status }),
          ...(priority === '' ? {} : { priority }),
          ...(people.length === 0 ? {} : { assignees: people }),
        })
      }
      return api.patchIssue(props.issue.id, {
        status: status === '' ? null : status,
        priority: priority === '' ? null : priority,
        assignees: people,
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries()
      props.onOpenChange(false)
    },
  })

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={
        editing ? (
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="outline">{editing.repository}</Badge>
            <span>#{editing.number}</span>
          </span>
        ) : (
          t('dialog.newIssue')
        )
      }
      description={editing ? t('dialog.editDescription') : t('dialog.createDescription')}
      footer={
        <Button
          variant="primary"
          size="sm"
          disabled={submit.isPending || (props.mode === 'create' && (title.trim() === '' || repository === ''))}
          onClick={() => submit.mutate()}
        >
          {props.mode === 'create' ? t('dialog.createOnGitHub') : t('dialog.saveToGitHub')}
        </Button>
      }
    >
      {submit.error ? <ErrorBox error={submit.error} /> : null}

      <div className="space-y-3">
        {props.mode === 'create' ? (
          <>
            <label className="block">
              <span className="text-xs text-subtle">{t('dialog.repository')}</span>
              <Select
                value={repository}
                onChange={(event) => setRepository(event.target.value)}
                aria-label={t('dialog.repository')}
              >
                {props.repositories.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block">
              <span className="text-xs text-subtle">{t('dialog.title')}</span>
              <Input value={title} onChange={(event) => setTitle(event.target.value)} aria-label={t('dialog.title')} />
            </label>
            <label className="block">
              <span className="text-xs text-subtle">{t('dialog.body')}</span>
              <Input value={body} onChange={(event) => setBody(event.target.value)} aria-label={t('dialog.body')} />
            </label>
          </>
        ) : (
          <>
            <p className="text-sm text-ink">{editing!.title}</p>
            <a
              className="text-xs text-accent hover:underline"
              href={editing!.htmlUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              {t('openOnGitHub', { defaultValue: 'Open on GitHub' })}
            </a>
            <IssueEnvironments issue={editing!} />
            {editing!.metadataSource === 'labels' ? (
              <p className="text-[11px] text-subtle">{t('statusFromLabelHint', {
                defaultValue:
                  "This issue's status comes from the status: label convention, so changing it adds one label and removes another — and that shows in the issue's timeline.",
              })}</p>
            ) : null}
          </>
        )}

        <label className="block">
          <span className="text-xs text-subtle">{t('dialog.status')}</span>
          <Select
            value={status}
            onChange={(event) => setStatus(event.target.value as WorkflowStatus | '')}
            aria-label={t('dialog.status')}
          >
            {statusOptions.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </Select>
        </label>

        <label className="block">
          <span className="text-xs text-subtle">{t('dialog.priority')}</span>
          <Select
            value={priority}
            onChange={(event) => setPriority(event.target.value as IssuePriority | '')}
            aria-label={t('dialog.priority')}
          >
            {priorityOptions.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </Select>
        </label>

        <label className="block">
          <span className="text-xs text-subtle">{t('dialog.assignees')}</span>
          <Input
            value={assignees}
            onChange={(event) => setAssignees(event.target.value)}
            placeholder={t('dialog.assigneesPlaceholder')}
            aria-label={t('dialog.assignees')}
          />
        </label>
      </div>
    </Dialog>
  )
}

function IssueEnvironments({ issue }: { issue: Issue }) {
  const { t } = useTranslation('issues')

  if (issue.environments.length === 0) {
    return (
      <div className="rounded-md border border-line bg-surface-2/40 px-3 py-2 text-xs text-subtle">
        {t('noEnvironmentIntro', { defaultValue: 'No environment is linked to this issue. Start one on a branch like' })}{' '}
        <span className="font-mono">fix/{issue.number}-…</span>,{' '}
        {t('noEnvironmentLabel', { defaultValue: 'label it' })}{' '}
        <span className="font-mono">dev-gateway.issue</span>,{' '}
        {t('noEnvironmentOutro', { defaultValue: 'or link one by hand.' })}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {issue.environments.map((environment) => (
        <div key={environment.project} className="rounded-md border border-line px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <a
              className="text-sm font-medium underline-offset-2 hover:text-accent hover:underline"
              href={environment.panelUrl}
            >
              {environment.project}
            </a>
            <Badge tone={environment.running ? 'ok' : 'outline'}>
              {t('environmentRunning', {
                defaultValue: '{{running}}/{{total}} running',
                running: environment.runningCount,
                total: environment.serviceCount,
              })}
            </Badge>
            {environment.unhealthyCount > 0 ? (
              <Badge tone="danger">
                {t('environmentUnhealthy', {
                  defaultValue: '{{count}} unhealthy',
                  count: environment.unhealthyCount,
                })}
              </Badge>
            ) : null}
            <a className="ml-auto text-xs text-accent hover:underline" href={environment.logsUrl}>
              {t('logsLink', { defaultValue: 'Logs' })}
            </a>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-subtle">
            <span>{environment.reason}</span>
            {environment.branch ? <span className="font-mono">{environment.branch}</span> : null}
          </div>
          {environment.running ? (
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-muted">
              {environment.urls.slice(0, 4).map((url) => (
                <a key={url.url} href={url.url} target="_blank" rel="noreferrer noopener" className="hover:text-accent">
                  {url.host}
                </a>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-[11px] text-subtle">
              {t('environmentNotRunning', {
                defaultValue:
                  'Not running. Start it on the host; the panel never starts an environment for you.',
              })}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}
