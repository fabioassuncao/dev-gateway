import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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
import { bytes, shortImage, uptime } from '../lib/format.ts'
import { ServiceIcon } from '../components/service-icon.tsx'
import { useDocumentTitle } from '../lib/title.ts'

const GROUPS: { ownership: Ownership; title: string; description: string }[] = [
  {
    ownership: 'gateway',
    title: 'Dev Gateway',
    description: 'The gateway’s own infrastructure. Managed by the CLI, not from here.',
  },
  {
    ownership: 'integrated',
    title: 'Integrated projects',
    description: 'Compose projects connected to the gateway: routed, or on the shared network.',
  },
  {
    ownership: 'external',
    title: 'External Docker',
    description: 'Compose projects on this host that the gateway does not manage.',
  },
  {
    ownership: 'standalone',
    title: 'Standalone containers',
    description: 'Started by hand, outside any Compose project.',
  },
]

export function DockerPage() {
  useDocumentTitle('Docker')
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
        title="Docker host"
        description="Every container on this machine, whether or not the gateway knows about it."
        actions={
          <>
            <Select
              value={ownership}
              onChange={(event) => setOwnership(event.target.value as 'all' | Ownership)}
              className="w-40"
              aria-label="Filter by ownership"
            >
              <option value="all">All</option>
              <option value="gateway">Dev Gateway</option>
              <option value="integrated">Integrated</option>
              <option value="external">External</option>
              <option value="standalone">Standalone</option>
            </Select>
            <Select
              value={state}
              onChange={(event) => setState(event.target.value)}
              className="w-32"
              aria-label="Filter by state"
            >
              <option value="all">Any state</option>
              <option value="running">Running</option>
              <option value="stopped">Stopped</option>
              <option value="unhealthy">Unhealthy</option>
            </Select>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search container, image, project"
              className="w-64"
              aria-label="Search containers"
            />
          </>
        }
      />

      {host.data ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatTile
            label="Running"
            value={host.data.containers.running}
            hint={`${host.data.containers.total} containers total`}
          />
          <StatTile label="Dev Gateway" value={host.data.byOwnership.gateway} />
          <StatTile label="Integrated" value={host.data.byOwnership.integrated} />
          <StatTile
            label="External"
            value={host.data.byOwnership.external + host.data.byOwnership.standalone}
          />
          <StatTile label="Networks" value={host.data.networks.length} />
          <StatTile
            label="Port conflicts"
            value={conflicts.length}
            tone={conflicts.length > 0 ? 'warn' : 'ok'}
          />
        </div>
      ) : null}

      <div className="mt-4 space-y-4">
        {ownership === 'all' ? (
          GROUPS.map((group) => {
            const rows = filtered.filter((container) => container.ownership === group.ownership)
            if (rows.length === 0) return null
            return (
              <ContainerGroup
                key={group.ownership}
                title={group.title}
                description={group.description}
                containers={rows}
                onDetails={setDetails}
              />
            )
          })
        ) : (
          <ContainerGroup
            title={GROUPS.find((group) => group.ownership === ownership)?.title ?? 'Containers'}
            description={GROUPS.find((group) => group.ownership === ownership)?.description ?? ''}
            containers={filtered}
            onDetails={setDetails}
          />
        )}

        {filtered.length === 0 ? (
          <Card>
            <Empty title="No container matches the filters" />
          </Card>
        ) : null}
      </div>

      {host.data ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Published ports"
              description="Useful for spotting the container that already holds the port you need."
            />
            {host.data.ports.length === 0 ? (
              <Empty title="Nothing is published on the host" />
            ) : (
              <Table aria-label="Published ports">
                <thead>
                  <tr>
                    <Th>Port</Th>
                    <Th>Bound by</Th>
                    <Th>Owner</Th>
                  </tr>
                </thead>
                <tbody>
                  {host.data.ports.map((port) => (
                    <Tr key={`${port.hostPort}/${port.protocol}`}>
                      <Td className="font-mono text-xs">
                        {port.hostPort}/{port.protocol}
                        {port.conflict ? (
                          <Badge tone="warn" className="ml-2">
                            conflict
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
                        {[...new Set(port.bindings.map((binding) => binding.ownership))].map(
                          (owner) => (
                            <OwnershipBadge key={owner} ownership={owner} />
                          ),
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader title="Engine" />
            <div className="px-4 py-3">
              <dl className="divide-y divide-line/60">
                <KeyValue label="Docker">
                  {host.data.engine.version} (API {host.data.engine.apiVersion})
                </KeyValue>
                <KeyValue label="Host">{host.data.engine.name}</KeyValue>
                <KeyValue label="Platform">
                  {host.data.engine.os} · {host.data.engine.arch}
                </KeyValue>
                <KeyValue label="Resources">
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
            <Th>Container</Th>
            <Th>Image</Th>
            <Th>Status</Th>
            <Th>Project</Th>
            <Th>Ports</Th>
            <Th>Networks</Th>
            <Th>Up</Th>
            <Th className="text-right">Actions</Th>
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
                {container.project ?? '-'}
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
