import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useEnvironmentOwners, useEnvironments } from '../lib/queries/index.ts'
import type { Environment } from '../../shared/types.ts'
import { Card } from '../components/ui/card.tsx'
import { Input, Select } from '../components/ui/field.tsx'
import { Empty, ErrorBox, Loading, PageHeader } from '../components/shell-bits.tsx'
import { EnvironmentCard } from '../components/entities/environment-card.tsx'
import { useDocumentTitle } from '../lib/title.ts'

type Filter = 'all' | 'unattributed' | 'running' | 'remembered'

/** Every Compose project on this host, adopted or not: what is running, as opposed to what is being built. */
export function EnvironmentsPage() {
  const { t } = useTranslation('environments', { keyPrefix: 'list' })
  useDocumentTitle(t('title'))
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const query = useEnvironments(true)
  const { owners } = useEnvironmentOwners()

  const environments = useMemo(() => {
    let list = [...(query.data ?? [])].sort((left, right) => {
      // Pinned first, archived last; a remembered one (containers gone) sits after the live ones of its rank.
      const rank = (environment: Environment) =>
        (environment.overrides?.pinned ? -2 : 0) + (environment.overrides?.archived ? 4 : 0) + (environment.presence === 'remembered' ? 1 : 0)
      return rank(left) - rank(right)
    })
    if (filter === 'unattributed') list = list.filter((environment) => !owners.has(environment.name))
    if (filter === 'running') list = list.filter((environment) => environment.runningCount > 0)
    if (filter === 'remembered') list = list.filter((environment) => environment.presence === 'remembered')
    if (search.trim() !== '') {
      const needle = search.toLowerCase()
      list = list.filter((environment) =>
        [environment.name, ...environment.services.map((service) => `${service.service} ${service.image}`)]
          .join(' ')
          .toLowerCase()
          .includes(needle),
      )
    }
    return list
  }, [query.data, search, filter, owners])

  if (query.isPending) return <Loading />
  if (query.error) return <ErrorBox error={query.error} />

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={filter} onChange={(event) => setFilter(event.target.value as Filter)} className="w-40" aria-label={t('filterAria')}>
              <option value="all">{t('all')}</option>
              <option value="running">{t('running')}</option>
              <option value="remembered">{t('remembered')}</option>
              <option value="unattributed">{t('unattributed')}</option>
            </Select>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('title')}
              className="w-64"
              aria-label={t('filterAria')}
            />
          </div>
        }
      />
      {(query.data ?? []).length === 0 ? (
        <Card><Empty title={t('empty')} hint={t('emptyHint')} /></Card>
      ) : environments.length === 0 ? (
        <Card><Empty title={t('noMatch')} /></Card>
      ) : (
        <div className="space-y-4">
          {environments.map((environment) => (
            <EnvironmentCard key={environment.name} environment={environment} owner={owners.get(environment.name) ?? null} />
          ))}
        </div>
      )}
    </>
  )
}
