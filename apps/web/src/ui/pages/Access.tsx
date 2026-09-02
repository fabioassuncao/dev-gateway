import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plug, PlugZap, X } from 'lucide-react'
import { api } from '../lib/api.ts'
import type { Bridge, TcpService } from '../../shared/types.ts'
import { Card, CardHeader } from '../components/ui/card.tsx'
import { Badge } from '../components/ui/badge.tsx'
import { Button } from '../components/ui/button.tsx'
import { Table, Td, Th, Tr } from '../components/ui/table.tsx'
import { Empty, ErrorBox, Loading, PageHeader } from '../components/shell-bits.tsx'
import { CopyButton } from '../components/copy.tsx'
import { ConnectionPanel } from '../components/connection-panel.tsx'
import { StateBadge } from '../components/status.tsx'
import { useFormat } from '../lib/use-format.ts'
import { ServiceIcon } from '../components/service-icon.tsx'
import { useDocumentTitle } from '../lib/title.ts'

function GatewayAddress({ service, enabled }: { service: TcpService; enabled: boolean }) {
  const { t } = useTranslation('access')
  const { gatewayAddress, gatewayConnectionString, routing } = service

  if (gatewayAddress) {
    return (
      <div>
        <div className="flex items-center gap-1">
          <span className="font-mono text-xs text-ink">{gatewayAddress}</span>
          <CopyButton value={gatewayAddress} label={t('services.copyAddress')} />
          {gatewayConnectionString ? (
            <CopyButton value={gatewayConnectionString} label={t('services.copyGatewayConnectionString')} />
          ) : null}
        </div>
        <div className="text-[11px] text-subtle">
          {routing === 'tls-sni' ? t('services.tlsRequiredHostname') : t('services.tlsRequiredSslmode')}
        </div>
      </div>
    )
  }

  if (routing === 'unsupported') {
    return (
      <div>
        <Badge tone="neutral">{t('services.noHostnameSharing')}</Badge>
        <div className="text-[11px] text-subtle">{t('services.serverSpeaksFirst')}</div>
      </div>
    )
  }

  if (routing === 'unevaluated') {
    return <span className="text-xs text-subtle">{t('services.notEvaluated')}</span>
  }

  return (
    <div>
      <span className="text-xs text-subtle">
        {enabled ? t('services.notOptedIn') : t('services.routingOff')}
      </span>
      <div className="text-[11px] text-subtle">
        {enabled ? t('services.addTcpOverlay') : t('services.tcpDisabled')}
      </div>
    </div>
  )
}

export function Access() {
  const { t } = useTranslation('access')
  const { expiresIn, shortImage } = useFormat()
  useDocumentTitle(t('title'))
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
      <PageHeader title={t('title')} description={t('description')} />

      {error ? (
        <div className="mb-4">
          <ErrorBox error={error} />
        </div>
      ) : null}

      <Card>
        <CardHeader title={t('bridges.title')} description={t('bridges.description')} />
        {bridges.length === 0 ? (
          <Empty title={t('bridges.empty')} hint={t('bridges.emptyHint')} />
        ) : (
          <Table aria-label={t('bridges.aria')}>
            <thead>
              <tr>
                <Th>{t('bridges.service')}</Th>
                <Th>{t('bridges.localAddress')}</Th>
                <Th>{t('bridges.connectionString')}</Th>
                <Th>{t('bridges.expires')}</Th>
                <Th className="text-right">{t('bridges.actions')}</Th>
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
                      <CopyButton value={bridge.bindIp} label={t('bridges.copyHost')} />
                      <CopyButton value={String(bridge.localPort ?? '')} label={t('bridges.copyPort')} />
                    </div>
                    <div className="text-[11px] text-subtle">
                      {t('bridges.target', { service: bridge.service, port: bridge.targetPort })}
                    </div>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1">
                      <span className="truncate font-mono text-xs text-muted">
                        {bridge.connectionString}
                      </span>
                      <CopyButton value={bridge.connectionString} label={t('bridges.copyConnectionString')} />
                    </div>
                    <div className="text-[11px] text-subtle">{t('bridges.credentialsHint')}</div>
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
                      {t('bridges.close')}
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
          title={t('services.title')}
          description={
            query.data.tcpRoutingEnabled
              ? t('services.descriptionEnabled')
              : t('services.descriptionDisabled')
          }
        />
        {services.length === 0 ? (
          <Empty title={t('services.empty')} />
        ) : (
          <Table aria-label={t('services.aria')}>
            <thead>
              <tr>
                <Th>{t('services.project')}</Th>
                <Th>{t('services.service')}</Th>
                <Th>{t('services.kind')}</Th>
                <Th>{t('services.image')}</Th>
                <Th>{t('services.port')}</Th>
                <Th>{t('services.status')}</Th>
                <Th>{t('services.gatewayAddress')}</Th>
                <Th className="text-right">{t('services.localAccess')}</Th>
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
                    <ConnectionPanel project={service.project} service={service.service} />
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
                        {t('services.openLocalAccess')}
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
        <CardHeader title={t('forwarders.title')} description={t('forwarders.description')} />
        {forwarders.length === 0 ? (
          <Empty title={t('forwarders.empty')} hint={t('forwarders.emptyHint')} />
        ) : (
          <Table aria-label={t('forwarders.aria')}>
            <thead>
              <tr>
                <Th>{t('forwarders.alias')}</Th>
                <Th>{t('forwarders.service')}</Th>
                <Th>{t('forwarders.port')}</Th>
                <Th>{t('forwarders.status')}</Th>
                <Th>{t('forwarders.networks')}</Th>
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
