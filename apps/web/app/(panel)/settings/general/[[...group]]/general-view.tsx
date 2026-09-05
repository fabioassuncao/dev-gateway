'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'next/navigation'
import { Save } from 'lucide-react'
import type { ConfigField } from 'portta-contracts'
import { slug } from 'portta-core/browser'
import { api } from '@/lib/api'
import { keys, useConfig } from '@/lib/queries'
import { useCan } from '@/lib/permissions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Callout, Empty, ErrorBox, Loading, PageHeader } from '@/components/shell-bits'
import { SettingsGroup } from '@/components/settings/settings-group'
import { SettingsNav } from '@/components/settings/settings-nav'
import { AgentPermissionsCard } from '@/components/settings/agent-permissions-card'
import { DashboardCard } from '@/components/dashboard-card'
import { ProjectDomainCard } from '@/components/domain-card'

/** GitHub is a group of the same file, shown in its own section. */
const ELSEWHERE = new Set(['GitHub'])

export function GeneralView({ group }: { group: string | null }) {
  const { t } = useTranslation('settings')
  const { t: tc } = useTranslation('common')
  const queryClient = useQueryClient()
  const router = useRouter()
  const mayManage = useCan('settings:manage')
  const [draft, setDraft] = useState<Record<string, string | null>>({})
  const [error, setError] = useState<unknown>(null)
  const [saved, setSaved] = useState(false)
  const query = useConfig()

  const view = query.data
  const groups = useMemo(() => (view?.groups ?? []).filter((name) => !ELSEWHERE.has(name)), [view?.groups])
  const activeGroup = groups.find((name) => slug(name) === group) ?? (group === null ? groups[0] : undefined)

  useEffect(() => {
    const first = groups[0]
    if (group === null && first) router.replace(`/settings/general/${slug(first)}`)
  }, [group, groups, router])

  const save = useMutation({
    mutationFn: () => api.patchConfig(draft),
    onSuccess: () => {
      setDraft({})
      setError(null)
      setSaved(true)
      void queryClient.invalidateQueries({ queryKey: keys.config() })
    },
    onError: (cause) => {
      setSaved(false)
      setError(cause)
    },
  })

  const dirtyCounts = useMemo(() => {
    const counts = new Map<string, number>()
    if (!view) return counts
    const fieldGroups = new Map(view.fields.map((field) => [field.key, field.group]))
    for (const key of Object.keys(draft)) {
      const fieldGroup = fieldGroups.get(key)
      if (fieldGroup) counts.set(fieldGroup, (counts.get(fieldGroup) ?? 0) + 1)
    }
    return counts
  }, [draft, view])

  if (query.isPending) return <Loading />
  if (query.error) return <ErrorBox error={query.error} />
  if (!view) return null

  const dirty = Object.keys(draft).length > 0
  const fields = activeGroup ? view.fields.filter((field) => field.group === activeGroup) : []

  const valueOf = (field: ConfigField): string => {
    const pending = draft[field.key]
    if (pending !== undefined) return pending ?? ''
    return field.secret ? '' : (field.value ?? '')
  }

  const setValue = (key: string, value: string | null) => {
    setSaved(false)
    setDraft((current) => ({ ...current, [key]: value }))
  }

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          mayManage ? (
            <>
              {dirty ? <Badge tone="warn">{tc('unsaved', { count: Object.keys(draft).length })}</Badge> : null}
              <Button
                variant="primary"
                disabled={!dirty || save.isPending || !view.envFile.writable}
                onClick={() => save.mutate()}
              >
                <Save />
                {save.isPending ? tc('saving') : tc('save')}
              </Button>
            </>
          ) : null
        }
      />

      {!view.envFile.writable ? (
        <Callout tone="warn" className="mb-4">
          {t('notWritable', { path: view.envFile.path })}
        </Callout>
      ) : null}

      {error ? (
        <div className="mb-4">
          <ErrorBox error={error} />
        </div>
      ) : null}

      {/* Confirmation that the file was written, and nothing more. What is
          pending, and how to apply it, is the global bar's job: it says the
          same thing on every page instead of only on this one. */}
      {saved && !dirty ? (
        <Callout tone="ok" role="status" className="mb-4">
          {t('savedShort')}
        </Callout>
      ) : null}

      <div className="flex min-w-0 flex-col gap-4 md:flex-row md:items-start">
        <SettingsNav groups={groups} active={activeGroup ?? null} dirtyCounts={dirtyCounts} />
        {activeGroup ? (
          <div className="min-w-0 flex-1 space-y-4">
            <SettingsGroup name={activeGroup} fields={fields} valueOf={valueOf} onChange={setValue} />
            {activeGroup === 'Project domain' ? <ProjectDomainCard domain={view.projectDomain} /> : null}
            {activeGroup === 'Traefik' ? <DashboardCard /> : null}
            {activeGroup === 'Panel' ? <AgentPermissionsCard editable={mayManage} /> : null}
          </div>
        ) : (
          <div className="min-w-0 flex-1 rounded-lg border border-line bg-surface">
            <Empty title={t('sectionNotFound', { group: group ?? '' })} hint={t('chooseGroup')} />
          </div>
        )}
      </div>

      <p className="mt-4 text-xs text-subtle">{t('secretsNote', { path: view.envFile.path })}</p>
    </>
  )
}
