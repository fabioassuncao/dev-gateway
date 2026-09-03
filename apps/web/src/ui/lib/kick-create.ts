import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type TaskBody } from './api/index.ts'
import { TASK_DRAFT_TITLE } from './task-draft.ts'
import { keys } from './queries/index.ts'
import { navigate } from './router.ts'
import { taskHref } from './tasks.ts'

/** Create (or reopen) a draft and open its workspace. */
export function useKickCreate(slug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: TaskBody | void) => api.createTask(slug, { title: TASK_DRAFT_TITLE, draft: true, ...(body ?? {}) }),
    onSuccess: (task) => {
      queryClient.setQueryData(keys.task(task.id), task)
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
      navigate(taskHref(slug, task.id).replace(/^#/, ''))
    },
  })
}
