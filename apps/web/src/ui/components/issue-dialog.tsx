import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api.ts'
import type { Issue, IssuePriority, WorkflowStatus } from '../../shared/types.ts'
import { Badge } from './ui/badge.tsx'
import { Button } from './ui/button.tsx'
import { Dialog } from './ui/dialog.tsx'
import { Input, Select } from './ui/field.tsx'
import { ErrorBox } from './shell-bits.tsx'

const STATUSES: { value: WorkflowStatus | ''; label: string }[] = [
  { value: '', label: 'No status' },
  { value: 'backlog', label: 'Backlog' },
  { value: 'ready', label: 'Ready' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'review', label: 'Review' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'done', label: 'Done' },
]

const PRIORITIES: { value: IssuePriority | ''; label: string }[] = [
  { value: '', label: 'No priority' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]

/**
 * Creating and editing, both writing through to GitHub.
 *
 * There is no optimistic row here: the panel never shows an issue GitHub did
 * not confirm, so the dialog waits for the answer and the projection is
 * updated from it.
 */
export function IssueDialog(
  props:
    | { mode: 'create'; repositories: string[]; open: boolean; onOpenChange: (open: boolean) => void }
    | { mode: 'edit'; issue: Issue; open: boolean; onOpenChange: (open: boolean) => void },
) {
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
          'New issue'
        )
      }
      description={
        editing
          ? 'Changes are written to GitHub, and the panel shows what GitHub confirmed.'
          : 'The issue is opened on GitHub; the panel projects what GitHub returned.'
      }
      footer={
        <Button
          variant="primary"
          size="sm"
          disabled={submit.isPending || (props.mode === 'create' && (title.trim() === '' || repository === ''))}
          onClick={() => submit.mutate()}
        >
          {props.mode === 'create' ? 'Create on GitHub' : 'Save to GitHub'}
        </Button>
      }
    >
      {submit.error ? <ErrorBox error={submit.error} /> : null}

      <div className="space-y-3">
        {props.mode === 'create' ? (
          <>
            <label className="block">
              <span className="text-xs text-subtle">Repository</span>
              <Select
                value={repository}
                onChange={(event) => setRepository(event.target.value)}
                aria-label="Repository"
              >
                {props.repositories.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block">
              <span className="text-xs text-subtle">Title</span>
              <Input value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Title" />
            </label>
            <label className="block">
              <span className="text-xs text-subtle">Body</span>
              <Input value={body} onChange={(event) => setBody(event.target.value)} aria-label="Body" />
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
              Open on GitHub
            </a>
            {editing!.metadataSource === 'labels' ? (
              <p className="text-[11px] text-subtle">
                This issue’s status comes from the <span className="font-mono">status:</span> label
                convention, so changing it adds one label and removes another — and that shows in the
                issue’s timeline.
              </p>
            ) : null}
          </>
        )}

        <label className="block">
          <span className="text-xs text-subtle">Status</span>
          <Select
            value={status}
            onChange={(event) => setStatus(event.target.value as WorkflowStatus | '')}
            aria-label="Status"
          >
            {STATUSES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </Select>
        </label>

        <label className="block">
          <span className="text-xs text-subtle">Priority</span>
          <Select
            value={priority}
            onChange={(event) => setPriority(event.target.value as IssuePriority | '')}
            aria-label="Priority"
          >
            {PRIORITIES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </Select>
        </label>

        <label className="block">
          <span className="text-xs text-subtle">Assignees</span>
          <Input
            value={assignees}
            onChange={(event) => setAssignees(event.target.value)}
            placeholder="comma-separated GitHub logins"
            aria-label="Assignees"
          />
        </label>
      </div>
    </Dialog>
  )
}
