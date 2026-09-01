import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('network')
  const { t: tc } = useTranslation('common')
  useDocumentTitle(t('title'))
  const query = useQuery({ queryKey: ['network'], queryFn: api.network })

  if (query.isPending) return <Loading />
  if (query.error) return <ErrorBox error={query.error} />
  if (!query.data) return null

  const { domains, routes, networks, tailscale, dns, tls } = query.data

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title={t('domains.title')} />
          <CardBody>
            <dl className="divide-y divide-line/60">
              <KeyValue label={t('domains.routedDomain')}>
                <span className="font-mono text-xs">{domains.local}</span>
              </KeyValue>
              <KeyValue label={t('domains.vpnDomain')}>
                <span className="font-mono text-xs">{domains.private ?? '—'}</span>
              </KeyValue>
              <KeyValue label={t('domains.publicDomain')}>
                <span className="font-mono text-xs">{domains.public ?? '—'}</span>
              </KeyValue>
              <KeyValue label={t('domains.scheme')}>{domains.scheme}</KeyValue>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('tls.title')} />
          <CardBody>
            <dl className="divide-y divide-line/60">
              <KeyValue label={t('tls.https')}>
                <Badge tone={tls.enabled ? 'ok' : 'neutral'}>
                  {tls.enabled ? tc('enabled') : tc('disabled')}
                </Badge>
              </KeyValue>
              <KeyValue label={t('tls.mode')}>{tls.mode}</KeyValue>
              <KeyValue label={t('tls.acmeContact')}>
                <Badge tone={tls.acmeEmailSet ? 'ok' : 'warn'}>
                  {tls.acmeEmailSet ? tc('set') : tc('notSet')}
                </Badge>
              </KeyValue>
              <KeyValue label={t('tls.directory')}>
                <span className="font-mono text-[11px] break-all">{tls.caServer}</span>
              </KeyValue>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('vpnDns.title')} />
          <CardBody>
            <dl className="divide-y divide-line/60">
              <KeyValue label={t('vpnDns.tailscale')}>
                {tailscale.enabled ? (
                  <StateBadge state={tailscale.state} health={tailscale.health} />
                ) : (
                  <Badge>{tc('disabled')}</Badge>
                )}
              </KeyValue>
              <KeyValue label={t('vpnDns.tailnetHostname')}>
                <span className="font-mono text-xs">{tailscale.hostname}</span>
              </KeyValue>
              <KeyValue label={t('vpnDns.dnsProvider')}>{dns.provider}</KeyValue>
              <KeyValue label={t('vpnDns.cloudflare')}>
                <Badge tone={dns.cloudflareEnabled ? 'ok' : 'neutral'}>
                  {dns.cloudflareEnabled ? (dns.zone ?? tc('enabled')) : tc('disabled')}
                </Badge>
              </KeyValue>
            </dl>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title={t('routes.title')} description={t('routes.description')} />
        {routes.length === 0 ? (
          <Empty title={t('routes.empty')} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t('routes.project')}</Th>
                <Th>{t('routes.service')}</Th>
                <Th>{t('routes.status')}</Th>
                <Th>{t('routes.targetPort')}</Th>
                <Th>{t('routes.addresses')}</Th>
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
        <CardHeader title={t('networks.title')} />
        <Table>
          <thead>
            <tr>
              <Th>{t('networks.name')}</Th>
              <Th>{t('networks.role')}</Th>
              <Th>{t('networks.driver')}</Th>
              <Th>{t('networks.containers')}</Th>
              <Th>{t('networks.flags')}</Th>
            </tr>
          </thead>
          <tbody>
            {networks.map((network) => (
              <Tr key={network.id}>
                <Td className="font-mono text-xs">{network.name}</Td>
                <Td>
                  <Badge tone={ROLE_TONE[network.role]}>{t(`networks.roles.${network.role}`)}</Badge>
                </Td>
                <Td className="text-xs text-muted">{network.driver}</Td>
                <Td className="text-xs tabular-nums">{network.containerCount}</Td>
                <Td className="flex gap-1">
                  {network.internal ? <Badge tone="info">{t('networks.internal')}</Badge> : null}
                  {network.managed ? <Badge tone="accent">{t('networks.gateway')}</Badge> : null}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  )
}
