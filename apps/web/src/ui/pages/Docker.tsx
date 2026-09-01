import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api.ts'
import type { ContainerSummary, Ownership } from '../../shared/types.ts'
import { Card, CardHeader } from '../components/ui/card.tsx'
import { Badge } from '../components/ui/badge.tsx'
import { Input, Select } from '../components/ui/field.tsx'
import { Table, Td, Th, Tr } from '../components/ui/table.tsx'
import { Empty, ErrorBox, KeyValue, Loading, PageHeader, StatTile } from '../components/shell-bits.tsx'
import { Mono } from '../components/copy.tsx'
import { OwnershipBadge, StateBadge } from '../components/status.tsx'
import { ContainerActions } from '../components/container-actions.tsx'
import { ContainerDetails } from '../components/container-details.tsx'
import { useFormat } from '../lib/use-format.ts'
import { ServiceIcon } from '../components/service-icon.tsx'
import { useDocumentTitle } from '../lib/title.ts'

const GROUP_KEYS: Ownership[] = ['gateway', 'integrated', 'external', 'standalone']

export function DockerPage() {
  const { t } = useTranslation('docker')
  const { t: tc } = useTranslation('common')
  const { bytes } = useFormat()
  useDocumentTitle(t('title'))
  const [search, setSearch] = useState('')
  const [ownership, setOwnership] = useState<'all' | Ownership>('all')
  const [state, setState] = useState('all')
  const [details, setDetails] = useState<ContainerSummary | null>(null)

  const host = useQuery({ queryKey: ['host'], queryFn: api.host })
  const containers = useQuery({
    queryKey: ['containers'],
    queryFn: () => api.containers(),
  })

  const filtered = useMemo(() => {
    let list = containers.data?.containers ?? []
    if (ownership !== 'all') list = list.filter((container) => container.ownership === ownership)
    if (state === 'running') list = list.filter((container) => container.state === 'running')
    if (state === 'stopped') list = list.filter((container) => container.state !== 'running')
    if (state === 'unhealthy') list = list.filter((container) => container.health === 'unhealthy')
    if (search.trim() !== '') {
      const needle = search.toLowerCase()
      list = list.filter((container) =>
        [container.name, container.image, container.project ?? '', container.service ?? '']
          .join(' ')
          .toLowerCase()
          .includes(needle),
      )
    }
    return list
  }, [containers.data, ownership, state, search])

  if (containers.isPending) return <Loading />
  if (containers.error) return <ErrorBox error={containers.error} />

  const conflicts = (host.data?.ports ?? []).filter((port) => port.conflict)

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <>
            <Select
              value={ownership}
              onChange={(event) => setOwnership(event.target.value as 'all' | Ownership)}
              className="w-40"
              aria-label={t('filterOwnership')}
            >
              <option value="all">{tc('all')}</option>
              <option value="gateway">{tc('ownership.gateway')}</option>
              <option value="integrated">{tc('ownership.integrated')}</option>
              <option value="external">{tc('ownership.external')}</option>
              <option value="standalone">{tc('ownership.standalone')}</option>
            </Select>
            <Select
              value={state}
              onChange={(event) => setState(event.target.value)}
              className="w-32"
              aria-label={t('filterState')}
            >
              <option value="all">{t('anyState', { defaultValue: 'Any state' })}</option>
              <option value="running">{tc('running')}</option>
              <option value="stopped">{tc('stopped')}</option>
              <option value="unhealthy">{tc('unhealthy')}</option>
            </Select>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('searchPlaceholder')}
              className="w-64"
              aria-label={t('searchAria')}
            />
          </>
        }
      />

      {host.data ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatTile
            label={t('stats.running')}
            value={host.data.containers.running}
            hint={t('containersTotal', {
              defaultValue: '{{total}} containers total',
              total: host.data.containers.total,
            })}
          />
          <StatTile label={t('stats.gateway')} value={host.data.byOwnership.gateway} />
          <StatTile label={t('stats.integrated')} value={host.data.byOwnership.integrated} />
          <StatTile
            label={t('stats.external')}
            value={host.data.byOwnership.external + host.data.byOwnership.standalone}
          />
          <StatTile label={t('stats.networks')} value={host.data.networks.length} />
          <StatTile
            label={t('stats.portConflicts')}
            value={conflicts.length}
            tone={conflicts.length > 0 ? 'warn' : 'ok'}
          />
        </div>
      ) : null}

      <div className="mt-4 space-y-4">
        {ownership === 'all' ? (
          GROUP_KEYS.map((key) => {
            const rows = filtered.filter((container) => container.ownership === key)
            if (rows.length === 0) return null
            return (
              <ContainerGroup
                key={key}
                title={t(`groups.${key}.title`)}
                description={t(`groups.${key}.description`)}
                containers={rows}
                onDetails={setDetails}
              />
            )
          })
        ) : (
          <ContainerGroup
            title={t(`groups.${ownership}.title`, { defaultValue: t('containers') })}
            description={t(`groups.${ownership}.description`, { defaultValue: '' })}
            containers={filtered}
            onDetails={setDetails}
          />
        )}

        {filtered.length === 0 ? (
          <Card>
            <Empty title={t('empty')} />
          </Card>
        ) : null}
      </div>

      {host.data ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader
              title={t('publishedPorts.title')}
              description={t('publishedPorts.description')}
            />
            {host.data.ports.length === 0 ? (
              <Empty title={t('publishedPorts.empty')} />
            ) : (
              <Table aria-label={t('publishedPorts.aria')}>
                <thead>
                  <tr>
                    <Th>{t('publishedPorts.hostPort', { defaultValue: 'Port' })}</Th>
                    <Th>{t('publishedPorts.container', { defaultValue: 'Bound by' })}</Th>
                    <Th>{t('publishedPorts.owner', { defaultValue: 'Owner' })}</Th>
                  </tr>
                </thead>
                <tbody>
                  {host.data.ports.map((port) => (
                    <Tr key={`${port.hostPort}/${port.protocol}`}>
                      <Td className="font-mono text-xs">
                        {port.hostPort}/{port.protocol}
                        {port.conflict ? (
                          <Badge tone="warn" className="ml-2">
                            {t('publishedPorts.conflictBadge', { defaultValue: 'conflict' })}
                          </Badge>
                        ) : null}
                      </Td>
                      <Td className="text-xs">
                        {port.bindings.map((binding) => (
                          <div key={binding.containerId + binding.ip}>
                            <span className="font-mono text-muted">{binding.ip}</span>{' '}
                            {binding.containerName}
                          </div>
                        ))}
                      </Td>
                      <Td>
                        {[...new Set(port.bindings.map((binding) => binding.ownership))].map((owner) => (
                          <OwnershipBadge key={owner} ownership={owner} />
                        ))}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader title={t('engine.title')} />
            <div className="px-4 py-3">
              <dl className="divide-y divide-line/60">
                <KeyValue label={t('engine.docker')}>
                  {host.data.engine.version} (API {host.data.engine.apiVersion})
                </KeyValue>
                <KeyValue label={t('engine.host')}>{host.data.engine.name}</KeyValue>
                <KeyValue label={t('engine.platform')}>
                  {host.data.engine.os} · {host.data.engine.arch}
                </KeyValue>
                <KeyValue label={t('engine.resources')}>
                  {host.data.engine.cpus} CPU · {bytes(host.data.engine.memoryBytes)}
                </KeyValue>
              </dl>
            </div>
          </Card>
        </div>
      ) : null}

      {details ? (
        <ContainerDetails
          container={details}
          open={details !== null}
          onOpenChange={(open) => !open && setDetails(null)}
        />
      ) : null}
    </>
  )
}

function ContainerGroup({
  title,
  description,
  containers,
  onDetails,
}: {
  title: string
  description: string
  containers: ContainerSummary[]
  onDetails: (container: ContainerSummary) => void
}) {
  const { t } = useTranslation('docker')
  const { shortImage, uptime } = useFormat()

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            {title}
            <Badge>{containers.length}</Badge>
          </span>
        }
        description={description}
      />
      <Table aria-label={title}>
        <thead>
          <tr>
            <Th>{t('table.name', { defaultValue: 'Container' })}</Th>
            <Th>{t('table.image')}</Th>
            <Th>{t('table.state')}</Th>
            <Th>{t('table.project')}</Th>
            <Th>{t('table.ports')}</Th>
            <Th>{t('networks', { defaultValue: 'Networks' })}</Th>
            <Th>{t('table.uptime', { defaultValue: 'Up' })}</Th>
            <Th className="text-right">{t('table.actions')}</Th>
          </tr>
        </thead>
        <tbody>
          {containers.map((container) => (
            <Tr key={container.id}>
              <Td>
                <button
                  className="flex items-center gap-1.5 text-left font-medium text-ink hover:text-accent"
                  onClick={() => onDetails(container)}
                >
                  <ServiceIcon tech={container.tech} />
                  <span>{container.name}</span>
                </button>
                <div className="mt-0.5">
                  <OwnershipBadge ownership={container.ownership} />
                </div>
              </Td>
              <Td className="font-mono text-xs text-muted">{shortImage(container.image)}</Td>
              <Td>
                <StateBadge state={container.state} health={container.health} />
              </Td>
              <Td className="text-xs text-muted">
                {container.project ? (
                  <a
                    className="underline-offset-2 hover:text-accent hover:underline"
                    href={`#/projects/${encodeURIComponent(container.project)}`}
                  >
                    {container.project}
                  </a>
                ) : (
                  '-'
                )}
                {container.service ? (
                  <span className="text-subtle"> · {container.service}</span>
                ) : null}
              </Td>
              <Td className="font-mono text-xs text-muted">
                {container.ports.length
                  ? container.ports.map((port) => `${port.ip}:${port.hostPort}`).join(' ')
                  : '-'}
              </Td>
              <Td>
                <Mono value={container.networks.join(', ') || '-'} />
              </Td>
              <Td className="text-xs text-muted tabular-nums">{uptime(container.uptimeSeconds)}</Td>
              <Td>
                <ContainerActions container={container} onShowDetails={() => onDetails(container)} />
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </Card>
  )
}
