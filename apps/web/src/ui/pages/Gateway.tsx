import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2, RotateCw, Stethoscope, XCircle } from 'lucide-react'
import { api } from '../lib/api.ts'
import { Card, CardBody, CardHeader } from '../components/ui/card.tsx'
import { Badge } from '../components/ui/badge.tsx'
import { Button } from '../components/ui/button.tsx'
import { Select } from '../components/ui/field.tsx'
import { Empty, ErrorBox, KeyValue, Loading, PageHeader } from '../components/shell-bits.tsx'
import { StateBadge } from '../components/status.tsx'
import { DiagnosticText } from '../components/diagnostic-text.tsx'
import { LogViewer } from '../components/logs.tsx'
import { useFormat } from '../lib/use-format.ts'
import { useDocumentTitle } from '../lib/title.ts'

const COMPONENTS = ['traefik', 'socket-proxy', 'tailscale', 'db'] as const

export function Gateway() {
  const { t } = useTranslation('gateway')
  const { t: tc } = useTranslation('common')
  const { relativeTime } = useFormat()
  useDocumentTitle(t('title'))
  const queryClient = useQueryClient()
  const [component, setComponent] = useState<string>('traefik')
  const [error, setError] = useState<unknown>(null)

  const status = useQuery({ queryKey: ['gateway'], queryFn: api.gateway })

  const doctor = useMutation({
    mutationFn: api.doctor,
    onError: setError,
    onSuccess: () => setError(null),
  })

  const restart = useMutation({
    mutationFn: (components: string[]) => api.restartGateway(components),
    onSuccess: () => {
      setError(null)
      void queryClient.invalidateQueries()
    },
    onError: setError,
  })

  if (status.isPending) return <Loading />
  if (status.error) return <ErrorBox error={status.error} />
  if (!status.data) return null

  const gateway = status.data

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <>
            <Button size="sm" disabled={doctor.isPending} onClick={() => doctor.mutate()}>
              <Stethoscope className="h-3.5 w-3.5" />
              {doctor.isPending ? t('checking') : t('runDiagnostics')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={restart.isPending}
              onClick={() => restart.mutate(['traefik'])}
            >
              <RotateCw className={restart.isPending ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
              {t('restartTraefik')}
            </Button>
          </>
        }
      />

      {error ? (
        <div className="mb-4">
          <ErrorBox error={error} />
        </div>
      ) : null}

      {restart.data ? (
        <div className="mb-4 rounded-md border border-info/40 bg-info/5 px-3 py-2 text-sm text-info">
          {t('restarted', {
            components: restart.data.restarted.join(', '),
            note: restart.data.note,
          })}{' '}
          <span className="font-mono text-xs">{restart.data.applyCommand}</span>
        </div>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title={t('components.title')} />
          <CardBody>
            <dl className="divide-y divide-line/60">
              <KeyValue label={t('components.traefik')}>
                <StateBadge state={gateway.traefik.state} health={gateway.traefik.health} />
              </KeyValue>
              <KeyValue label={t('components.socketProxy')}>
                <StateBadge state={gateway.socketProxy.state} />
              </KeyValue>
              <KeyValue label={t('components.persistence')}>
                <StateBadge state={gateway.database.state} health={gateway.database.health} />
              </KeyValue>
              <KeyValue label={t('components.tailscale')}>
                {gateway.tailscale.enabled ? (
                  <Badge tone={gateway.tailscale.running ? 'ok' : 'warn'}>
                    {gateway.tailscale.running ? tc('running') : t('components.notRunning')}
                  </Badge>
                ) : (
                  <Badge>{tc('disabled')}</Badge>
                )}
              </KeyValue>
              <KeyValue label={t('components.sharedNetwork')}>
                <Badge tone={gateway.network.exists ? 'ok' : 'danger'}>
                  {gateway.network.exists
                    ? t('components.attached', { count: gateway.network.attached })
                    : t('components.missing')}
                </Badge>
              </KeyValue>
              <KeyValue label={t('components.routedServices')}>{gateway.routes}</KeyValue>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('versions.title')} />
          <CardBody>
            <dl className="divide-y divide-line/60">
              <KeyValue label={t('versions.gateway')}>{gateway.gatewayVersion}</KeyValue>
              <KeyValue label={t('versions.panel')}>{gateway.panelVersion}</KeyValue>
              <KeyValue label={t('versions.profile')}>{gateway.profile}</KeyValue>
              <KeyValue label={t('versions.domain')}>
                <span className="font-mono text-xs">{gateway.domain}</span>
              </KeyValue>
              <KeyValue label={t('versions.traefikDashboard')}>
                {gateway.dashboard.enabled ? (
                  <span className="font-mono text-xs">
                    {gateway.dashboard.bindAddress}:{gateway.dashboard.port}
                  </span>
                ) : (
                  <Badge>{tc('disabled')}</Badge>
                )}
              </KeyValue>
              <KeyValue label={t('versions.thisPanel')}>
                {!gateway.panel.routed ? (
                  <Badge>{t('versions.loopbackOnly')}</Badge>
                ) : gateway.panel.authenticated ? (
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Badge tone="ok">{t('versions.routedForwardAuth')}</Badge>
                    <span className="font-mono text-xs">{gateway.panel.user}</span>
                  </span>
                ) : (
                  <Badge tone="danger">{t('versions.routedNoCredential')}</Badge>
                )}
                {gateway.panel.readOnly ? <Badge>{t('versions.readOnly')}</Badge> : null}
              </KeyValue>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={t('diagnostics.title')}
            description={
              doctor.data
                ? t('diagnostics.summary', {
                    failures: doctor.data.failures,
                    warnings: doctor.data.warnings,
                    time: relativeTime(doctor.data.ranAt),
                  })
                : t('diagnostics.description')
            }
          />
          {doctor.data ? (
            <ul className="max-h-72 divide-y divide-line/70 overflow-y-auto scroll-thin">
              {doctor.data.checks.map((check) => (
                <li key={check.id} className="flex gap-2 px-4 py-2">
                  {check.status === 'pass' ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" />
                  ) : check.status === 'warn' ? (
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
                  ) : (
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
                  )}
                  <div className="min-w-0">
                    <DiagnosticText diagnostic={check} part="title" className="text-xs font-medium text-ink" />
                    <DiagnosticText diagnostic={check} part="detail" className="text-[11px] text-muted" />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title={t('diagnostics.notRun')} hint={t('diagnostics.notRunHint')} />
          )}
          {doctor.data ? (
            <div className="border-t border-line px-4 py-2 text-[11px] text-subtle">
              {t('diagnostics.deeperChecks')}{' '}
              <span className="font-mono">{doctor.data.hostCommand}</span>
            </div>
          ) : null}
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title={t('logs.title')}
          actions={
            <Select
              value={component}
              onChange={(event) => setComponent(event.target.value)}
              className="w-40"
              aria-label={t('logs.componentAria')}
            >
              {COMPONENTS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          }
        />
        <div className="h-96 min-h-0">
          <LogViewer
            queryKey={['gateway-logs', component]}
            load={(tail) => api.gatewayLogs(component, tail)}
            className="h-full"
          />
        </div>
      </Card>
    </>
  )
}
