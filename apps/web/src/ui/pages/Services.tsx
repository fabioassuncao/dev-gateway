import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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
import { shortImage, uptime } from '../lib/format.ts'
import { ServiceIcon } from '../components/service-icon.tsx'
import { useDocumentTitle } from '../lib/title.ts'

const SCOPES: UrlScope[] = ['local', 'vpn', 'public']

export function Services() {
  useDocumentTitle('Services')
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
        title="Services"
        description="Every service of every integrated project, and how to reach it."
        actions={
          <>
            <Select
              value={state}
              onChange={(event) => setState(event.target.value)}
              className="w-32"
              aria-label="Filter services"
            >
              <option value="all">All</option>
              <option value="running">Running</option>
              <option value="stopped">Stopped</option>
              <option value="unhealthy">Unhealthy</option>
              <option value="http">HTTP</option>
              <option value="tcp">TCP</option>
            </Select>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search service, image, hostname"
              className="w-64"
              aria-label="Search services"
            />
          </>
        }
      />

      <Card>
        {services.length === 0 ? (
          <Empty title="No service matches" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Project</Th>
                <Th>Service</Th>
                <Th>Image</Th>
                <Th>Type</Th>
                <Th>Status</Th>
                <Th>Port</Th>
                <Th>Addresses</Th>
                <Th>Up</Th>
                <Th className="text-right">Actions</Th>
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
                    <Badge tone={service.traefikEnabled ? 'info' : 'neutral'}>
                      {service.kind}
                    </Badge>
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
                        {service.traefikEnabled ? 'no route' : 'reached over a TCP bridge'}
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
