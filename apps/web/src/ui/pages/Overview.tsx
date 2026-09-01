import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { api } from '../lib/api.ts'
import { navigate } from '../lib/router.ts'
import { Card, CardBody, CardHeader } from '../components/ui/card.tsx'
import { Badge } from '../components/ui/badge.tsx'
import { Button } from '../components/ui/button.tsx'
import { Empty, ErrorBox, KeyValue, Loading, PageHeader, StatTile } from '../components/shell-bits.tsx'
import { AddressLine } from '../components/copy.tsx'
import { ScopeBadge } from '../components/status.tsx'
import { DiagnosticText } from '../components/diagnostic-text.tsx'
import { useDocumentTitle } from '../lib/title.ts'

export function Overview() {
  const { t } = useTranslation('overview')
  useDocumentTitle(t('title'))
  const query = useQuery({ queryKey: ['status'], queryFn: api.overview })

  if (query.isPending) return <Loading label={t('readingGateway')} />
  if (query.error) return <ErrorBox error={query.error} />
  if (!query.data) return null

  const { gateway, counts, problems, urls } = query.data
  const failures = problems.filter((problem) => problem.status === 'fail')

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Badge tone={gateway.up ? 'ok' : 'danger'}>
            {gateway.up ? t('gatewayRunning') : t('gatewayDown')}
          </Badge>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label={t('stats.projects')}
          value={counts.integratedProjects}
          hint={t('stats.projectsHint', { count: counts.projects })}
        />
        <StatTile
          label={t('stats.services')}
          value={`${counts.servicesRunning}/${counts.services}`}
          hint={t('stats.servicesHint', { healthy: counts.servicesHealthy })}
          tone={counts.servicesUnhealthy > 0 ? 'warn' : undefined}
        />
        <StatTile
          label={t('stats.routedUrls')}
          value={counts.routes}
          hint={t('stats.routedUrlsHint', { scheme: gateway.scheme })}
        />
        <StatTile
          label={t('stats.containersRunning')}
          value={counts.containersRunning}
          hint={t('stats.containersRunningHint', { total: counts.containersTotal })}
        />
        <StatTile
          label={t('stats.outsideGateway')}
          value={counts.containersExternal + counts.containersStandalone}
          hint={t('stats.outsideGatewayHint', {
            gateway: counts.containersGateway,
            integrated: counts.containersIntegrated,
          })}
        />
        <StatTile
          label={t('stats.problems')}
          value={problems.length}
          tone={failures.length > 0 ? 'danger' : problems.length > 0 ? 'warn' : 'ok'}
          hint={
            failures.length > 0
              ? t('stats.problemsHintFail', { count: failures.length })
              : problems.length > 0
                ? t('stats.problemsHintWarn')
                : t('stats.problemsHintOk')
          }
        />
      </div>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title={t('detectedProblems.title')}
            description={t('detectedProblems.description')}
            actions={
              <Button size="sm" onClick={() => navigate('/gateway')}>
                {t('detectedProblems.runDiagnostics')}
              </Button>
            }
          />
          {problems.length === 0 ? (
            <CardBody>
              <div className="flex items-center gap-2 text-sm text-ok">
                <CheckCircle2 className="h-4 w-4" />
                {t('detectedProblems.none')}
              </div>
            </CardBody>
          ) : (
            <ul className="divide-y divide-line/70">
              {problems.map((problem) => (
                <li key={problem.id} className="flex gap-2.5 px-4 py-2.5">
                  {problem.status === 'fail' ? (
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
                  )}
                  <div className="min-w-0">
                    <DiagnosticText diagnostic={problem} part="title" className="text-sm font-medium text-ink" />
                    <DiagnosticText diagnostic={problem} part="detail" className="text-xs text-muted" />
                    {problem.fix ? (
                      <DiagnosticText
                        diagnostic={problem}
                        part="fix"
                        className="mt-0.5 font-mono text-[11px] text-subtle"
                      />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title={t('gatewayCard.title')} />
          <CardBody>
            <dl className="divide-y divide-line/60">
              <KeyValue label={t('gatewayCard.profile')}>{gateway.profile}</KeyValue>
              <KeyValue label={t('gatewayCard.domain')}>
                <span className="font-mono text-xs">{gateway.domain}</span>
              </KeyValue>
              <KeyValue label={t('gatewayCard.listening')}>
                <span className="font-mono text-xs">
                  {gateway.bindAddress}:{gateway.httpPort} / {gateway.httpsPort}
                </span>
              </KeyValue>
              <KeyValue label={t('gatewayCard.tls')}>
                {gateway.tls.enabled ? (
                  <Badge tone="ok">{t('gatewayCard.tlsEnabled', { mode: gateway.tls.mode })}</Badge>
                ) : (
                  <Badge>{t('disabled', { ns: 'common' })}</Badge>
                )}
              </KeyValue>
              <KeyValue label={t('gatewayCard.tailscale')}>
                {gateway.tailscale.enabled ? (
                  <Badge tone={gateway.tailscale.running ? 'ok' : 'warn'}>
                    {gateway.tailscale.running
                      ? t('gatewayCard.tailscaleRunning')
                      : t('gatewayCard.tailscaleEnabledNotRunning')}
                  </Badge>
                ) : (
                  <Badge>{t('disabled', { ns: 'common' })}</Badge>
                )}
              </KeyValue>
              <KeyValue label={t('gatewayCard.publicAccess')}>
                {gateway.publicAccess.enabled ? (
                  <Badge tone="warn">{gateway.publicAccess.domain ?? t('enabled', { ns: 'common' })}</Badge>
                ) : (
                  <Badge>{t('disabled', { ns: 'common' })}</Badge>
                )}
              </KeyValue>
              <KeyValue label={t('gatewayCard.sharedNetwork')}>
                <span className="font-mono text-xs">
                  {t('gatewayCard.attached', {
                    name: gateway.network.name,
                    count: gateway.network.attached,
                  })}
                </span>
              </KeyValue>
            </dl>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title={t('availableUrls.title')}
          description={t('availableUrls.description')}
          actions={
            <Button size="sm" onClick={() => navigate('/network')}>
              {t('availableUrls.allRoutes')}
            </Button>
          }
        />
        {urls.length === 0 ? (
          <Empty title={t('availableUrls.empty')} hint={t('availableUrls.emptyHint')} />
        ) : (
          <ul className="divide-y divide-line/70">
            {urls.slice(0, 12).map((url) => (
              <li key={url.url} className="flex items-center gap-2 px-4 py-2">
                <ScopeBadge scope={url.scope} />
                <AddressLine value={url.url} href={url.url} className="min-w-0 flex-1" />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
