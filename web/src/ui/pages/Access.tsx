import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plug, PlugZap, X } from 'lucide-react'
import { api } from '../lib/api.ts'
import type { Bridge, TcpService } from '../../shared/types.ts'
import { Card, CardHeader } from '../components/ui/card.tsx'
import { Badge } from '../components/ui/badge.tsx'
import { Button } from '../components/ui/button.tsx'
import { Table, Td, Th, Tr } from '../components/ui/table.tsx'
import { Empty, ErrorBox, Loading, PageHeader } from '../components/shell-bits.tsx'
import { CopyButton } from '../components/copy.tsx'
import { StateBadge } from '../components/status.tsx'
import { expiresIn, shortImage } from '../lib/format.ts'
import { ServiceIcon } from '../components/service-icon.tsx'

/**
 * What the gateway can offer for this protocol. The point is to be plain about
 * the limits rather than hide them: MySQL cannot share a port by hostname, and
 * saying so beats leaving somebody to find out.
 */
function GatewayAddress({ service, enabled }: { service: TcpService; enabled: boolean }) {
  const { gatewayAddress, gatewayConnectionString, routing } = service

  if (gatewayAddress) {
    return (
      <div>
        <div className="flex items-center gap-1">
          <span className="font-mono text-xs text-ink">{gatewayAddress}</span>
          <CopyButton value={gatewayAddress} label="Copy address" />
          {gatewayConnectionString ? (
            <CopyButton value={gatewayConnectionString} label="Copy gateway connection string" />
          ) : null}
        </div>
        <div className="text-[11px] text-subtle">
          {routing === 'tls-sni'
            ? 'TLS required, and the client must send the hostname'
            : 'TLS required: sslmode=require'}
        </div>
      </div>
    )
  }

  if (routing === 'unsupported') {
    return (
      <div>
        <Badge tone="neutral">no hostname sharing</Badge>
        <div className="text-[11px] text-subtle">
          the server speaks first, so there is no hostname to route on
        </div>
      </div>
    )
  }

  if (routing === 'unevaluated') {
    return <span className="text-xs text-subtle">not evaluated for this protocol</span>
  }

  return (
    <div>
      <span className="text-xs text-subtle">
        {enabled ? 'not opted in' : 'hostname routing is off'}
      </span>
      <div className="text-[11px] text-subtle">
        {enabled ? 'add the TCP overlay to this project' : 'DEV_GATEWAY_TCP=false'}
      </div>
    </div>
  )
}

export function Access() {
  const queryClient = useQueryClient()
  const [error, setError] = useState<unknown>(null)
  const query = useQuery({ queryKey: ['access'], queryFn: api.access })

  const open = useMutation({
    mutationFn: (service: TcpService) =>
      api.openBridge({ project: service.project, service: service.service }),
    onSuccess: () => {
      setError(null)
      void queryClient.invalidateQueries()
    },
    onError: setError,
  })

  const close = useMutation({
    mutationFn: (bridge: Bridge) => api.closeBridge(bridge.id),
    onSuccess: () => {
      setError(null)
      void queryClient.invalidateQueries()
    },
    onError: setError,
  })

  if (query.isPending) return <Loading />
  if (query.error) return <ErrorBox error={query.error} />
  if (!query.data) return null

  const { services, bridges, forwarders } = query.data

  return (
    <>
      <PageHeader
        title="Access"
        description="Databases, caches and other TCP services: by hostname where the protocol allows it, and by a bridge opened on demand everywhere else."
      />

      {error ? (
        <div className="mb-4">
          <ErrorBox error={error} />
        </div>
      ) : null}

      <Card>
        <CardHeader
          title="Open bridges"
          description="Each bridge binds 127.0.0.1 on a port the kernel picks, so nothing has to give up 5432."
        />
        {bridges.length === 0 ? (
          <Empty
            title="No bridge is open"
            hint="Open one from the list below, or from the CLI: dev-gateway access open --project <p> --service <s>"
          />
        ) : (
          <Table aria-label="Open bridges">
            <thead>
              <tr>
                <Th>Service</Th>
                <Th>Local address</Th>
                <Th>Connection string</Th>
                <Th>Expires</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {bridges.map((bridge) => (
                <Tr key={bridge.id}>
                  <Td>
                    <div className="font-medium">
                      {bridge.project}
                      <span className="text-muted">/{bridge.service}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <Badge tone="info">{bridge.kind}</Badge>
                      <StateBadge state={bridge.state} />
                    </div>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1">
                      <span className="font-mono text-xs">
                        {bridge.bindIp}:{bridge.localPort ?? '?'}
                      </span>
                      <CopyButton value={bridge.bindIp} label="Copy host" />
                      <CopyButton value={String(bridge.localPort ?? '')} label="Copy port" />
                    </div>
                    <div className="text-[11px] text-subtle">
                      target {bridge.service}:{bridge.targetPort}
                    </div>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1">
                      <span className="truncate font-mono text-xs text-muted">
                        {bridge.connectionString}
                      </span>
                      <CopyButton value={bridge.connectionString} label="Copy connection string" />
                    </div>
                    <div className="text-[11px] text-subtle">
                      credentials come from the project, not from here
                    </div>
                  </Td>
                  <Td className="text-xs text-muted">{expiresIn(bridge.expiresAt)}</Td>
                  <Td className="text-right">
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={close.isPending}
                      onClick={() => close.mutate(bridge)}
                    >
                      <X className="h-3.5 w-3.5" />
                      Close
                    </Button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader
          title="TCP services"
          description={
            query.data.tcpRoutingEnabled
              ? 'Reached by hostname where the protocol allows it, and by a temporary loopback bridge everywhere else.'
              : 'Nothing here is published permanently: a bridge exists only while you need it.'
          }
        />
        {services.length === 0 ? (
          <Empty title="No TCP service is running" />
        ) : (
          <Table aria-label="TCP services">
            <thead>
              <tr>
                <Th>Project</Th>
                <Th>Service</Th>
                <Th>Kind</Th>
                <Th>Image</Th>
                <Th>Port</Th>
                <Th>Status</Th>
                <Th>Gateway address</Th>
                <Th className="text-right">Local access</Th>
              </tr>
            </thead>
            <tbody>
              {services.map((service) => (
                <Tr key={service.containerId}>
                  <Td className="text-xs text-muted">{service.project}</Td>
                  <Td>
                    <span className="flex items-center gap-1.5 font-medium">
                      <ServiceIcon tech={service.tech} />
                      {service.service}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={service.kind === 'tcp' ? 'neutral' : 'info'}>{service.kind}</Badge>
                  </Td>
                  <Td className="font-mono text-xs text-muted">{shortImage(service.image)}</Td>
                  <Td className="font-mono text-xs text-muted">
                    {service.defaultPort ?? service.ports[0] ?? '-'}
                  </Td>
                  <Td>
                    <StateBadge state={service.state} health={service.health} />
                  </Td>
                  <Td>
                    <GatewayAddress service={service} enabled={query.data.tcpRoutingEnabled} />
                  </Td>
                  <Td className="text-right">
                    {service.bridge ? (
                      <span className="font-mono text-xs text-ok">
                        {service.bridge.bindIp}:{service.bridge.localPort}
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={service.state !== 'running' || open.isPending}
                        onClick={() => open.mutate(service)}
                      >
                        <PlugZap className="h-3.5 w-3.5" />
                        Open local access
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader
          title="Published on the VPN"
          description="Persistent forwarders created with dev-gateway service publish --private."
        />
        {forwarders.length === 0 ? (
          <Empty
            title="Nothing is published privately"
            hint="dev-gateway service publish --private --project <p> --service <s>"
          />
        ) : (
          <Table aria-label="Published on the VPN">
            <thead>
              <tr>
                <Th>Alias</Th>
                <Th>Service</Th>
                <Th>Port</Th>
                <Th>Status</Th>
                <Th>Networks</Th>
              </tr>
            </thead>
            <tbody>
              {forwarders.map((forwarder) => (
                <Tr key={forwarder.alias}>
                  <Td className="flex items-center gap-1 font-mono text-xs">
                    <Plug className="h-3.5 w-3.5 text-subtle" />
                    {forwarder.alias}
                  </Td>
                  <Td className="text-xs">
                    {forwarder.project}/{forwarder.service}
                  </Td>
                  <Td className="font-mono text-xs">{forwarder.port}</Td>
                  <Td>
                    <StateBadge state={forwarder.state} />
                  </Td>
                  <Td className="font-mono text-[11px] text-muted">
                    {forwarder.networks.join(', ')}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  )
}
