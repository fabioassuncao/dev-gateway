import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { IssuePriority, WorkflowStatus } from '../../shared/types.ts'

function statusKey(status: string): string {
  return status === 'in_progress' ? 'inProgress' : status
}

export function useIssueStatuses() {
  const { t } = useTranslation('issues')

  return useMemo(
    () => ({
      statusLabel: (status: WorkflowStatus | string | null | undefined): string =>
        status
          ? String(t(`status.${statusKey(status)}` as 'status.backlog', { defaultValue: status }))
          : t('status.none'),
      statusOptions: [
        { value: '' as const, label: t('status.none') },
        { value: 'backlog' as const, label: t('status.backlog') },
        { value: 'ready' as const, label: t('status.ready') },
        { value: 'in_progress' as const, label: t('status.inProgress') },
        { value: 'review' as const, label: t('status.review') },
        { value: 'blocked' as const, label: t('status.blocked') },
        { value: 'done' as const, label: t('status.done') },
      ],
      priorityOptions: [
        { value: '' as const, label: t('priority.none') },
        { value: 'low' as const, label: t('priority.low') },
        { value: 'medium' as const, label: t('priority.medium') },
        { value: 'high' as const, label: t('priority.high') },
        { value: 'urgent' as const, label: t('priority.urgent') },
      ],
      priorityLabel: (priority: IssuePriority | string): string =>
        String(t(`priority.${priority}` as 'priority.low', { defaultValue: priority })),
    }),
    [t],
  )
}

export function useBoardColumns() {
  const { t } = useTranslation('issues')

  return useMemo(
    () =>
      [
        { id: 'backlog', label: t('status.backlog'), status: 'backlog' as const },
        { id: 'ready', label: t('status.ready'), status: 'ready' as const },
        { id: 'in_progress', label: t('status.inProgress'), status: 'in_progress' as const },
        { id: 'review', label: t('status.review'), status: 'review' as const },
        { id: 'blocked', label: t('status.blocked'), status: 'blocked' as const },
        { id: 'done', label: t('status.done'), status: 'done' as const },
      ],
    [t],
  )
}
