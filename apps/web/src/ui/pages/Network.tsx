import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api.ts'
import { Card, CardBody, CardHeader } from '../components/ui/card.tsx'
import { Badge } from '../components/ui/badge.tsx'
import { Table, Td, Th, Tr } from '../components/ui/table.tsx'
import { Empty, ErrorBox, KeyValue, Loading, PageHeader } from '../components/shell-bits.tsx'
import { AddressLine } from '../components/copy.tsx'
import { ScopeBadge, StateBadge } from '../components/status.tsx'
import { useDocumentTitle } from '../lib/title.ts'

const ROLE_TONE = {
  shared: 'accent',
  control: 'info',
  access: 'info',
  project: 'neutral',
  other: 'outline',
} as const

export function NetworkPage() {
  useDocumentTitle('Network')
  const query = useQuery({ queryKey: ['network'], queryFn: api.network })

  if (query.isPending) return <Loading />
  if (query.error) return <ErrorBox error={query.error} />
  if (!query.data) return null

  const { domains, routes, networks, tailscale, dns, tls } = query.data

  return (
    <>
      <PageHeader
        title="Network"
        description="Domains, routes, DNS, TLS and the Docker networks behind them."
      />

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Domains" />
          <CardBody>
            <dl className="divide-y divide-line/60">
              <KeyValue label="Routed domain">
                <span className="font-mono text-xs">{domains.local}</span>
              </KeyValue>
              <KeyValue label="VPN domain">
                <span className="font-mono text-xs">{domains.private ?? '—'}</span>
              </KeyValue>
              <KeyValue label="Public domain">
                <span className="font-mono text-xs">{domains.public ?? '—'}</span>
              </KeyValue>
              <KeyValue label="Scheme">{domains.scheme}</KeyValue>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="TLS" />
          <CardBody>
            <dl className="divide-y divide-line/60">
              <KeyValue label="HTTPS">
                <Badge tone={tls.enabled ? 'ok' : 'neutral'}>
                  {tls.enabled ? 'enabled' : 'disabled'}
                </Badge>
              </KeyValue>
              <KeyValue label="Mode">{tls.mode}</KeyValue>
              <KeyValue label="ACME contact">
                <Badge tone={tls.acmeEmailSet ? 'ok' : 'warn'}>
                  {tls.acmeEmailSet ? 'set' : 'not set'}
                </Badge>
              </KeyValue>
              <KeyValue label="Directory">
                <span className="font-mono text-[11px] break-all">{tls.caServer}</span>
              </KeyValue>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="VPN and DNS" />
          <CardBody>
            <dl className="divide-y divide-line/60">
              <KeyValue label="Tailscale">
                {tailscale.enabled ? (
                  <StateBadge state={tailscale.state} health={tailscale.health} />
                ) : (
                  <Badge>disabled</Badge>
                )}
              </KeyValue>
              <KeyValue label="Tailnet hostname">
                <span className="font-mono text-xs">{tailscale.hostname}</span>
              </KeyValue>
              <KeyValue label="DNS-01 provider">{dns.provider}</KeyValue>
              <KeyValue label="Cloudflare">
                <Badge tone={dns.cloudflareEnabled ? 'ok' : 'neutral'}>
                  {dns.cloudflareEnabled ? (dns.zone ?? 'enabled') : 'disabled'}
                </Badge>
              </KeyValue>
            </dl>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Routes"
          description="Derived from Docker labels, exactly like Traefik derives them."
        />
        {routes.length === 0 ? (
          <Empty title="No service is routed yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Project</Th>
                <Th>Service</Th>
                <Th>Status</Th>
                <Th>Target port</Th>
                <Th>Addresses</Th>
              </tr>
            </thead>
            <tbody>
              {routes.map((route) => (
                <Tr key={route.containerId}>
                  <Td className="text-xs text-muted">{route.project ?? '-'}</Td>
                  <Td className="font-medium">{route.service ?? route.containerName}</Td>
                  <Td>
                    <StateBadge state={route.state} />
                  </Td>
                  <Td className="font-mono text-xs text-muted">{route.port}</Td>
                  <Td>
                    <div className="space-y-0.5">
                      {route.urls.map((url) => (
                        <div key={url.url} className="flex items-center gap-1.5">
                          <ScopeBadge scope={url.scope} />
                          <AddressLine value={url.url} href={url.url} />
                        </div>
                      ))}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader title="Docker networks" />
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Role</Th>
              <Th>Driver</Th>
              <Th>Containers</Th>
              <Th>Flags</Th>
            </tr>
          </thead>
          <tbody>
            {networks.map((network) => (
              <Tr key={network.id}>
                <Td className="font-mono text-xs">{network.name}</Td>
                <Td>
                  <Badge tone={ROLE_TONE[network.role]}>{network.role}</Badge>
                </Td>
                <Td className="text-xs text-muted">{network.driver}</Td>
                <Td className="text-xs tabular-nums">{network.containerCount}</Td>
                <Td className="flex gap-1">
                  {network.internal ? <Badge tone="info">internal</Badge> : null}
                  {network.managed ? <Badge tone="accent">gateway</Badge> : null}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  )
}
