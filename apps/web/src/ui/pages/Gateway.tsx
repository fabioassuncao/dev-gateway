import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, RotateCw, Stethoscope, XCircle } from 'lucide-react'
import { api } from '../lib/api.ts'
import { Card, CardBody, CardHeader } from '../components/ui/card.tsx'
import { Badge } from '../components/ui/badge.tsx'
import { Button } from '../components/ui/button.tsx'
import { Select } from '../components/ui/field.tsx'
import { Empty, ErrorBox, KeyValue, Loading, PageHeader } from '../components/shell-bits.tsx'
import { StateBadge } from '../components/status.tsx'
import { LogViewer } from '../components/logs.tsx'
import { relativeTime } from '../lib/format.ts'
import { useDocumentTitle } from '../lib/title.ts'

const COMPONENTS = ['traefik', 'socket-proxy', 'tailscale', 'db'] as const

export function Gateway() {
  useDocumentTitle('Gateway')
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
        title="Gateway"
        description="The gateway’s own components: status, diagnostics and logs."
        actions={
          <>
            <Button size="sm" disabled={doctor.isPending} onClick={() => doctor.mutate()}>
              <Stethoscope className="h-3.5 w-3.5" />
              {doctor.isPending ? 'Checking…' : 'Run diagnostics'}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={restart.isPending}
              onClick={() => restart.mutate(['traefik'])}
            >
              <RotateCw className={restart.isPending ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
              Restart Traefik
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
          Restarted {restart.data.restarted.join(', ')}. {restart.data.note}:{' '}
          <span className="font-mono text-xs">{restart.data.applyCommand}</span>
        </div>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Components" />
          <CardBody>
            <dl className="divide-y divide-line/60">
              <KeyValue label="Traefik">
                <StateBadge state={gateway.traefik.state} health={gateway.traefik.health} />
              </KeyValue>
              <KeyValue label="Socket proxy">
                <StateBadge state={gateway.socketProxy.state} />
              </KeyValue>
              <KeyValue label="Persistence">
                <StateBadge state={gateway.database.state} health={gateway.database.health} />
              </KeyValue>
              <KeyValue label="Tailscale">
                {gateway.tailscale.enabled ? (
                  <Badge tone={gateway.tailscale.running ? 'ok' : 'warn'}>
                    {gateway.tailscale.running ? 'running' : 'not running'}
                  </Badge>
                ) : (
                  <Badge>disabled</Badge>
                )}
              </KeyValue>
              <KeyValue label="Shared network">
                <Badge tone={gateway.network.exists ? 'ok' : 'danger'}>
                  {gateway.network.exists ? `${gateway.network.attached} attached` : 'missing'}
                </Badge>
              </KeyValue>
              <KeyValue label="Routed services">{gateway.routes}</KeyValue>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Versions and profile" />
          <CardBody>
            <dl className="divide-y divide-line/60">
              <KeyValue label="Gateway">{gateway.gatewayVersion}</KeyValue>
              <KeyValue label="Panel">{gateway.panelVersion}</KeyValue>
              <KeyValue label="Profile">{gateway.profile}</KeyValue>
              <KeyValue label="Domain">
                <span className="font-mono text-xs">{gateway.domain}</span>
              </KeyValue>
              <KeyValue label="Traefik dashboard">
                {gateway.dashboard.enabled ? (
                  <span className="font-mono text-xs">
                    {gateway.dashboard.bindAddress}:{gateway.dashboard.port}
                  </span>
                ) : (
                  <Badge>disabled</Badge>
                )}
              </KeyValue>
              <KeyValue label="This panel">
                {!gateway.panel.routed ? (
                  <Badge>loopback only</Badge>
                ) : gateway.panel.authenticated ? (
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Badge tone="ok">routed, behind BasicAuth</Badge>
                    <span className="font-mono text-xs">{gateway.panel.user}</span>
                  </span>
                ) : (
                  <Badge tone="danger">routed with no credential</Badge>
                )}
                {gateway.panel.readOnly ? <Badge>read-only</Badge> : null}
              </KeyValue>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Diagnostics"
            description={
              doctor.data
                ? `${doctor.data.failures} failure(s), ${doctor.data.warnings} warning(s) · ${relativeTime(doctor.data.ranAt)}`
                : 'Checks the panel can make from inside its container.'
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
                    <div className="text-xs font-medium text-ink">{check.title}</div>
                    <div className="text-[11px] text-muted">{check.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty
              title="Not run yet"
              hint="For host-level checks (PATH, listening sockets, DNS, certificate files) run dev-gateway doctor."
            />
          )}
          {doctor.data ? (
            <div className="border-t border-line px-4 py-2 text-[11px] text-subtle">
              deeper, host-level checks:{' '}
              <span className="font-mono">{doctor.data.hostCommand}</span>
            </div>
          ) : null}
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Logs"
          actions={
            <Select
              value={component}
              onChange={(event) => setComponent(event.target.value)}
              className="w-40"
              aria-label="Gateway component"
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
