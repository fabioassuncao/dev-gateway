import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Save, ShieldCheck } from 'lucide-react'
import type { ConfigField } from '../../shared/types.ts'
import { slug } from '../../shared/slug.ts'
import { api } from '../lib/api.ts'
import { navigate } from '../lib/router.ts'
import { Badge } from '../components/ui/badge.tsx'
import { Button } from '../components/ui/button.tsx'
import { Empty, ErrorBox, Loading, PageHeader } from '../components/shell-bits.tsx'
import { CopyButton } from '../components/copy.tsx'
import { SettingsGroup } from '../components/settings/settings-group.tsx'
import { SettingsNav } from '../components/settings/settings-nav.tsx'
import { GitHubStatusCard } from '../components/github-status.tsx'
import { useDocumentTitle } from '../lib/title.ts'

export function Settings({ group }: { group: string | null }) {
  const { t } = useTranslation('settings')
  const { t: tc } = useTranslation('common')
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Record<string, string | null>>({})
  const [error, setError] = useState<unknown>(null)
  const [saved, setSaved] = useState(false)
  const query = useQuery({ queryKey: ['config'], queryFn: api.config })

  const view = query.data
  const activeGroup =
    view?.groups.find((name) => slug(name) === group) ??
    (group === null ? view?.groups[0] : undefined)

  useDocumentTitle(activeGroup ? t(`groups.${activeGroup}`, { defaultValue: activeGroup }) : null, t('title'))

  useEffect(() => {
    const first = view?.groups[0]
    if (group === null && first) navigate(`/settings/${slug(first)}`)
  }, [group, view?.groups])

  const save = useMutation({
    mutationFn: () => api.patchConfig(draft),
    onSuccess: () => {
      setDraft({})
      setError(null)
      setSaved(true)
      void queryClient.invalidateQueries({ queryKey: ['config'] })
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
          <>
            {dirty ? <Badge tone="warn">{tc('unsaved', { count: Object.keys(draft).length })}</Badge> : null}
            <Button
              variant="primary"
              disabled={!dirty || save.isPending || !view.envFile.writable}
              onClick={() => save.mutate()}
            >
              <Save className="h-3.5 w-3.5" />
              {save.isPending ? tc('saving') : tc('save')}
            </Button>
          </>
        }
      />

      {!view.envFile.writable ? (
        <div className="mb-4 rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-sm text-warn">
          {t('notWritable', { path: view.envFile.path })}
        </div>
      ) : null}

      {error ? (
        <div className="mb-4">
          <ErrorBox error={error} />
        </div>
      ) : null}

      {(view.pendingRestart || saved) && !dirty ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-info/40 bg-info/5 px-3 py-2 text-sm text-info">
          <ShieldCheck className="h-4 w-4" />
          <span>{t('saved')}</span>
          <span className="font-mono text-xs">{view.applyCommand}</span>
          <CopyButton value={view.applyCommand} label={tc('copyCommand')} />
        </div>
      ) : null}

      <div className="flex min-w-0 flex-col gap-4 md:flex-row md:items-start">
        <SettingsNav groups={view.groups} active={activeGroup ?? null} dirtyCounts={dirtyCounts} />
        {activeGroup ? (
          <div className="min-w-0 flex-1 space-y-4">
            <SettingsGroup name={activeGroup} fields={fields} valueOf={valueOf} onChange={setValue} />
            {activeGroup === 'GitHub' ? <GitHubStatusCard /> : null}
          </div>
        ) : (
          <div className="min-w-0 flex-1 rounded-lg border border-line bg-surface">
            <Empty
              title={t('sectionNotFound', { group: group ?? '' })}
              hint={t('chooseGroup')}
            />
          </div>
        )}
      </div>

      <p className="mt-4 text-xs text-subtle">{t('secretsNote', { path: view.envFile.path })}</p>
    </>
  )
}
