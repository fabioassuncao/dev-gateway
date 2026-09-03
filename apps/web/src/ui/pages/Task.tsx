import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api, ApiError } from '../lib/api/index.ts'
import { keys, useGitHub, useProject, useProjectActivity, useSessions, useTask } from '../lib/queries/index.ts'
import type { Task, TaskStatus } from '../../shared/task-types.ts'
import { Card } from '../components/ui/card.tsx'
import { useToast } from '../components/ui/toast.tsx'
import { Empty, ErrorBox, Loading, PageHeader } from '../components/shell-bits.tsx'
import { TaskDetail } from '../components/entities/task-detail.tsx'
import { TaskDialog } from '../components/tasks/task-dialog.tsx'
import { navigate } from '../lib/router.ts'
import { taskHref, tasksHref } from '../lib/tasks.ts'
import type { BreadcrumbItem } from '../components/ui/breadcrumb.tsx'
import { useDocumentTitle } from '../lib/title.ts'

/** One task: what it is, who is on it, what came out of it, and what to do next. */
export function TaskPage({ slug, id, readOnly = false }: { slug: string; id: string; readOnly?: boolean }) {
  const { t } = useTranslation('tasks')
  const { t: tn } = useTranslation('nav')
  const queryClient = useQueryClient()
  const toast = useToast()
  const task = useTask(id)
  const project = useProject(slug)
  const sessions = useSessions(slug, { task: id })
  const activity = useProjectActivity(slug, { task: id, limit: '30' })
  const github = useGitHub()
  const [editing, setEditing] = useState(false)
  const [creatingSubtask, setCreatingSubtask] = useState(false)

  useDocumentTitle(task.data ? `#${task.data.id} ${task.data.title}` : `#${id}`, project.data?.name ?? slug)

  const refresh = (updated?: Task) => {
    if (updated) queryClient.setQueryData(keys.task(id), updated)
    void queryClient.invalidateQueries({ queryKey: keys.task(id) })
    void queryClient.invalidateQueries({ queryKey: ['tasks'] })
    void queryClient.invalidateQueries({ queryKey: keys.project(slug) })
    void queryClient.invalidateQueries({ queryKey: keys.activity(slug) })
    void queryClient.invalidateQueries({ queryKey: keys.developmentOverview() })
  }
  const failed = (error: unknown) => toast.push({ title: t('failed'), description: error instanceof Error ? error.message : String(error), tone: 'danger' })

  // Projects › project › Tasks › (#parent ›) #id. The tab is never a crumb.
  const crumbs = (parentId: string | null): BreadcrumbItem[] => [
    { label: tn('projects'), href: '#/projects' },
    { label: project.data?.name ?? slug, href: `#/projects/${encodeURIComponent(slug)}`, pending: project.isPending },
    { label: t('title'), href: `#${tasksHref(slug, 'board')}` },
    ...(parentId ? [{ label: `#${parentId}`, href: taskHref(slug, parentId) }] : []),
    { label: `#${id}` },
  ]

  const setStatus = useMutation({ mutationFn: (status: TaskStatus) => api.setTaskStatus(id, status), onSuccess: refresh, onError: failed })
  const start = useMutation({ mutationFn: () => api.startTask(id), onSuccess: refresh, onError: failed })
  const finish = useMutation({ mutationFn: (close: boolean) => api.finishTask(id, close), onSuccess: refresh, onError: failed })
  const setEnvironments = useMutation({ mutationFn: (environments: string[]) => api.setTaskEnvironments(id, environments), onSuccess: refresh, onError: failed })
  const link = useMutation({ mutationFn: (issue: string) => api.linkTaskGitHub(id, issue), onSuccess: refresh, onError: failed })
  const unlink = useMutation({ mutationFn: () => api.unlinkTaskGitHub(id), onSuccess: refresh, onError: failed })
  const publish = useMutation({ mutationFn: () => api.publishTaskGitHub(id), onSuccess: refresh, onError: failed })
  const sync = useMutation({ mutationFn: (resolve: 'local' | 'remote' | undefined) => api.syncTaskGitHub(id, resolve), onSuccess: refresh, onError: failed })
  const remove = useMutation({
    mutationFn: () => api.deleteTask(id),
    onSuccess: () => {
      refresh()
      navigate(tasksHref(slug, 'board'))
    },
    onError: failed,
  })

  if (task.isPending) return <Loading />
  if (task.error) {
    const status = task.error instanceof ApiError ? task.error.status : null
    return (
      <>
        <PageHeader title={`#${id}`} breadcrumb={crumbs(null)} />
        <Card>
          {status === 404 ? (
            <Empty title={t('notFound', { id })} hint={<a className="text-accent hover:underline" href={`#${tasksHref(slug, 'board')}`}>{t('backToTasks')}</a>} />
          ) : status === 503 ? (
            <Empty title={t('needsDatabase')} hint={t('needsDatabaseHint')} />
          ) : (
            <ErrorBox error={task.error} />
          )}
        </Card>
      </>
    )
  }

  const data = task.data!
  const environmentChoices = (project.data?.environments ?? []).map((entry) => entry.environment).filter((name) => !data.environments.some((link) => link.environment === name))

  return (
    <>
      <PageHeader title={`#${data.id} ${data.title}`} breadcrumb={crumbs(data.parentId)} />
      <TaskDetail
        task={data}
        sessions={sessions.data ?? []}
        events={activity.data?.events ?? []}
        environmentChoices={environmentChoices}
        readOnly={readOnly}
        githubConfigured={github.data?.status.configured ?? false}
        actions={{
          setStatus: (status) => setStatus.mutate(status),
          start: () => start.mutate(),
          finish: (close) => finish.mutate(close),
          addNote: (body) => api.addTaskNote(id, body).then(() => refresh()).catch((error: unknown) => { failed(error); throw error }),
          edit: () => setEditing(true),
          newSubtask: () => setCreatingSubtask(true),
          remove: () => {
            if (window.confirm(t('confirmDelete', { id: data.id }))) remove.mutate()
          },
          setEnvironments: (environments) => setEnvironments.mutate(environments),
          github: {
            link: (issue) => link.mutateAsync(issue),
            unlink: () => unlink.mutate(),
            publish: () => publish.mutate(),
            sync: (resolve) => sync.mutate(resolve),
            comment: (body) => api.commentTaskGitHub(id, body).then((created) => { toast.push({ title: t('github.commented'), description: created.htmlUrl, tone: 'ok' }); refresh() }).catch((error: unknown) => { failed(error); throw error }),
          },
        }}
      />
      {editing ? <TaskDialog mode="edit" slug={slug} task={data} project={project.data ?? null} open onOpenChange={setEditing} onSaved={refresh} /> : null}
      {creatingSubtask ? (
        <TaskDialog mode="create" slug={slug} parent={data} project={project.data ?? null} defaults={{ repositoryId: data.repository?.id ?? null }} open onOpenChange={setCreatingSubtask} onSaved={() => refresh()} />
      ) : null}
    </>
  )
}
