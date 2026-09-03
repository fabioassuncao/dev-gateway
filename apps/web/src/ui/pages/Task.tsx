import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api, ApiError, type TaskBody } from '../lib/api/index.ts'
import { keys, useGitHub, useProject, useProjectActivity, useSessions, useTask, useTasks } from '../lib/queries/index.ts'
import type { Task, TaskNote, TaskStatus } from '../../shared/task-types.ts'
import { Card } from '../components/ui/card.tsx'
import { Breadcrumb, type BreadcrumbItem } from '../components/ui/breadcrumb.tsx'
import { useToast } from '../components/ui/toast.tsx'
import { Empty, ErrorBox, Loading } from '../components/shell-bits.tsx'
import { TaskWorkspace } from '../components/tasks/task-workspace.tsx'
import { useKickCreate } from '../lib/kick-create.ts'
import { navigate } from '../lib/router.ts'
import { taskHref, tasksHref } from '../lib/tasks.ts'
import { useDocumentTitle } from '../lib/title.ts'

/** One task: what it is, who is on it, what came out of it, and what to do next. */
export function TaskPage({ slug, id, readOnly = false }: { slug: string; id: string; readOnly?: boolean }) {
  const { t } = useTranslation('tasks')
  const { t: tn } = useTranslation('nav')
  const queryClient = useQueryClient()
  const toast = useToast()
  const task = useTask(id)
  const project = useProject(slug)
  const siblings = useTasks(slug, {})
  const sessions = useSessions(slug, { task: id })
  const activity = useProjectActivity(slug, { task: id, limit: '30' })
  const github = useGitHub()
  const kickCreate = useKickCreate(slug)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  useDocumentTitle(task.data ? `#${task.data.id} ${task.data.title}` : `#${id}`, project.data?.name ?? slug)

  const refresh = (updated?: Task) => {
    if (updated) queryClient.setQueryData(keys.task(id), updated)
    void queryClient.invalidateQueries({ queryKey: keys.task(id) })
    void queryClient.invalidateQueries({ queryKey: ['tasks'] })
    void queryClient.invalidateQueries({ queryKey: keys.project(slug) })
    void queryClient.invalidateQueries({ queryKey: keys.activity(slug) })
    void queryClient.invalidateQueries({ queryKey: keys.developmentOverview() })
  }
  const failed = (error: unknown) => {
    setSaveState('error')
    toast.push({ title: t('failed'), description: error instanceof Error ? error.message : String(error), tone: 'danger' })
  }

  const crumbs = (parentId: string | null): BreadcrumbItem[] => [
    { label: tn('projects'), href: '#/projects' },
    { label: project.data?.name ?? slug, href: `#/projects/${encodeURIComponent(slug)}`, pending: project.isPending },
    { label: t('title'), href: `#${tasksHref(slug, 'board')}` },
    ...(parentId ? [{ label: `#${parentId}`, href: taskHref(slug, parentId) }] : []),
    { label: `#${id}` },
  ]

  const patch = useMutation({
    mutationFn: (body: TaskBody) => {
      setSaveState('saving')
      return api.patchTask(id, body)
    },
    onSuccess: (updated) => {
      setSaveState('saved')
      refresh(updated)
    },
    onError: failed,
  })
  const start = useMutation({ mutationFn: () => api.startTask(id), onSuccess: refresh, onError: failed })
  const finish = useMutation({ mutationFn: (close: boolean) => api.finishTask(id, close), onSuccess: refresh, onError: failed })
  const setStatus = useMutation({ mutationFn: (status: TaskStatus) => api.setTaskStatus(id, status), onSuccess: refresh, onError: failed })
  const link = useMutation({ mutationFn: ({ issue, initialSync }: { issue: string; initialSync: 'pull' | 'push' }) => api.linkTaskGitHub(id, issue, initialSync), onSuccess: refresh, onError: failed })
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
        <Breadcrumb items={crumbs(null)} />
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

  return (
    <>
      <div className="mb-4">
        <Breadcrumb items={crumbs(data.parentId)} />
      </div>
      <TaskWorkspace
        task={data}
        project={project.data ?? null}
        sessions={sessions.data ?? []}
        events={activity.data?.events ?? []}
        candidates={siblings.data ?? []}
        parentTitle={siblings.data?.find((entry) => entry.id === data.parentId)?.title ?? null}
        readOnly={readOnly}
        saveState={saveState}
        actions={{
          patch: (body) => patch.mutateAsync(body),
          start: () => start.mutate(),
          finish: (close) => finish.mutate(close),
          setStatus: (status) => setStatus.mutate(status),
          addNote: (body) => api.addTaskComment(id, body).then(() => refresh()).catch((error: unknown) => { failed(error); throw error }),
          editNote: (note: TaskNote, body: string) => api.updateTaskComment(id, note.id, body).then(() => refresh()).catch((error: unknown) => { failed(error); throw error }),
          deleteNote: (note) => { void api.deleteTaskComment(id, note.id).then(() => refresh()).catch(failed) },
          publishNote: (note) => api.publishTaskCommentGitHub(id, note.id).then(() => refresh()).catch((error: unknown) => { failed(error); throw error }),
          createSubtask: () => kickCreate.mutate({ parentId: data.id, repositoryId: data.repository?.id ?? null }),
          linkSubtask: (childId) => { void api.linkTaskSubtask(id, childId).then(() => refresh()).catch(failed) },
          unlinkSubtask: (childId) => { void api.unlinkTaskSubtask(id, childId).then(() => refresh()).catch(failed) },
          setSubtaskStatus: (childId, status) => { void api.setTaskStatus(childId, status).then(() => refresh()).catch(failed) },
          discard: () => {
            if (window.confirm(data.draft ? t('draft.confirmDiscard', { id: data.id }) : t('confirmDelete', { id: data.id }))) remove.mutate()
          },
          github: {
            configured: github.data?.status.configured ?? false,
            link: (issue, initialSync) => link.mutateAsync({ issue, initialSync }),
            unlink: () => unlink.mutate(),
            publish: () => publish.mutate(),
            sync: (resolve) => sync.mutate(resolve),
          },
        }}
      />
    </>
  )
}
