import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api.ts'
import type { ContainerSummary, UrlScope } from '../../shared/types.ts'
import { Card } from '../components/ui/card.tsx'
import { Badge } from '../components/ui/badge.tsx'
import { Input, Select } from '../components/ui/field.tsx'
import { Table, Td, Th, Tr } from '../components/ui/table.tsx'
import { Empty, ErrorBox, Loading, PageHeader } from '../components/shell-bits.tsx'
import { AddressLine } from '../components/copy.tsx'
import { ScopeBadge, StateBadge } from '../components/status.tsx'
import { ContainerActions } from '../components/container-actions.tsx'
import { ContainerDetails } from '../components/container-details.tsx'
import { useFormat } from '../lib/use-format.ts'
import { ServiceIcon } from '../components/service-icon.tsx'
import { useDocumentTitle } from '../lib/title.ts'

const SCOPES: UrlScope[] = ['local', 'vpn', 'public']

export function Services() {
  const { t } = useTranslation('services')
  const { t: tc } = useTranslation('common')
  const { shortImage, uptime } = useFormat()
  useDocumentTitle(t('title'))
  const [search, setSearch] = useState('')
  const [state, setState] = useState('all')
  const [details, setDetails] = useState<ContainerSummary | null>(null)
  const query = useQuery({ queryKey: ['services'], queryFn: api.services })

  const services = useMemo(() => {
    let list = query.data ?? []
    if (state === 'running') list = list.filter((service) => service.state === 'running')
    if (state === 'stopped') list = list.filter((service) => service.state !== 'running')
    if (state === 'unhealthy') list = list.filter((service) => service.health === 'unhealthy')
    if (state === 'http') list = list.filter((service) => service.traefikEnabled)
    if (state === 'tcp') list = list.filter((service) => !service.traefikEnabled)
    if (search.trim() !== '') {
      const needle = search.toLowerCase()
      list = list.filter((service) =>
        [service.project, service.service, service.image, ...service.urls.map((url) => url.host)]
          .join(' ')
          .toLowerCase()
          .includes(needle),
      )
    }
    return list
  }, [query.data, search, state])

  if (query.isPending) return <Loading />
  if (query.error) return <ErrorBox error={query.error} />

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <>
            <Select
              value={state}
              onChange={(event) => setState(event.target.value)}
              className="w-32"
              aria-label={t('filterAria')}
            >
              <option value="all">{tc('all')}</option>
              <option value="running">{tc('running')}</option>
              <option value="stopped">{tc('stopped')}</option>
              <option value="unhealthy">{tc('unhealthy')}</option>
              <option value="http">{t('filters.http')}</option>
              <option value="tcp">{t('filters.tcp')}</option>
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

      <Card>
        {services.length === 0 ? (
          <Empty title={t('empty')} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t('table.project')}</Th>
                <Th>{t('table.service')}</Th>
                <Th>{t('table.image')}</Th>
                <Th>{t('filters.http', { defaultValue: 'Type' })}</Th>
                <Th>{t('table.state')}</Th>
                <Th>{t('table.ports', { defaultValue: 'Port' })}</Th>
                <Th>{t('table.urls')}</Th>
                <Th>{t('table.uptime')}</Th>
                <Th className="text-right">{t('table.actions')}</Th>
              </tr>
            </thead>
            <tbody>
              {services.map((service) => (
                <Tr key={service.id}>
                  <Td className="text-xs text-muted">{service.project}</Td>
                  <Td>
                    <button
                      className="flex items-center gap-1.5 text-left font-medium text-ink hover:text-accent"
                      onClick={() => setDetails(service)}
                    >
                      <ServiceIcon tech={service.tech} />
                      <span>{service.service ?? service.name}</span>
                    </button>
                  </Td>
                  <Td className="font-mono text-xs text-muted">{shortImage(service.image)}</Td>
                  <Td>
                    <Badge tone={service.traefikEnabled ? 'info' : 'neutral'}>{service.kind}</Badge>
                  </Td>
                  <Td>
                    <StateBadge state={service.state} health={service.health} />
                  </Td>
                  <Td className="font-mono text-xs text-muted">
                    {service.exposedPorts.length ? service.exposedPorts.join(', ') : '-'}
                  </Td>
                  <Td>
                    {service.urls.length === 0 ? (
                      <span className="text-xs text-subtle">
                        {service.traefikEnabled
                          ? t('noRoute', { defaultValue: 'no route' })
                          : t('tcpBridge', { defaultValue: 'reached over a TCP bridge' })}
                      </span>
                    ) : (
                      <div className="space-y-0.5">
                        {SCOPES.flatMap((scope) =>
                          service.urls
                            .filter((url) => url.scope === scope)
                            .map((url) => (
                              <div key={url.url} className="flex items-center gap-1.5">
                                <ScopeBadge scope={url.scope} />
                                <AddressLine value={url.url} href={url.url} />
                              </div>
                            )),
                        )}
                      </div>
                    )}
                  </Td>
                  <Td className="text-xs text-muted tabular-nums">{uptime(service.uptimeSeconds)}</Td>
                  <Td>
                    <ContainerActions container={service} onShowDetails={() => setDetails(service)} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

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
