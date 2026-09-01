import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { api } from '../lib/api.ts'
import { navigate } from '../lib/router.ts'
import { Card, CardBody, CardHeader } from '../components/ui/card.tsx'
import { Badge } from '../components/ui/badge.tsx'
import { Button } from '../components/ui/button.tsx'
import { Empty, ErrorBox, KeyValue, Loading, PageHeader, StatTile } from '../components/shell-bits.tsx'
import { AddressLine } from '../components/copy.tsx'
import { ScopeBadge } from '../components/status.tsx'

export function Overview() {
  const query = useQuery({ queryKey: ['status'], queryFn: api.overview })

  if (query.isPending) return <Loading label="Reading the gateway" />
  if (query.error) return <ErrorBox error={query.error} />
  if (!query.data) return null

  const { gateway, counts, problems, urls } = query.data
  const failures = problems.filter((problem) => problem.status === 'fail')

  return (
    <>
      <PageHeader
        title="Overview"
        description="What the gateway is serving right now, and what else is running beside it."
        actions={
          <Badge tone={gateway.up ? 'ok' : 'danger'}>
            {gateway.up ? 'Gateway running' : 'Gateway down'}
          </Badge>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="Projects"
          value={counts.integratedProjects}
          hint={`${counts.projects} Compose project(s) on the host`}
        />
        <StatTile
          label="Services"
          value={`${counts.servicesRunning}/${counts.services}`}
          hint={`${counts.servicesHealthy} healthy`}
          tone={counts.servicesUnhealthy > 0 ? 'warn' : undefined}
        />
        <StatTile label="Routed URLs" value={counts.routes} hint={`over ${gateway.scheme}`} />
        <StatTile
          label="Containers running"
          value={counts.containersRunning}
          hint={`${counts.containersTotal} in total`}
        />
        <StatTile
          label="Outside the gateway"
          value={counts.containersExternal + counts.containersStandalone}
          hint={`${counts.containersGateway} gateway · ${counts.containersIntegrated} integrated`}
        />
        <StatTile
          label="Problems"
          value={problems.length}
          tone={failures.length > 0 ? 'danger' : problems.length > 0 ? 'warn' : 'ok'}
          hint={
            failures.length > 0
              ? `${failures.length} need attention`
              : problems.length > 0
                ? 'warnings only, nothing blocking'
                : 'nothing blocking'
          }
        />
      </div>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Detected problems"
            description="Everything the panel can check from inside the container."
            actions={
              <Button size="sm" onClick={() => navigate('/gateway')}>
                Run diagnostics
              </Button>
            }
          />
          {problems.length === 0 ? (
            <CardBody>
              <div className="flex items-center gap-2 text-sm text-ok">
                <CheckCircle2 className="h-4 w-4" />
                No problems detected.
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
                    <div className="text-sm font-medium text-ink">{problem.title}</div>
                    <div className="text-xs text-muted">{problem.detail}</div>
                    {problem.fix ? (
                      <div className="mt-0.5 font-mono text-[11px] text-subtle">{problem.fix}</div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Gateway" />
          <CardBody>
            <dl className="divide-y divide-line/60">
              <KeyValue label="Profile">{gateway.profile}</KeyValue>
              <KeyValue label="Domain">
                <span className="font-mono text-xs">{gateway.domain}</span>
              </KeyValue>
              <KeyValue label="Listening">
                <span className="font-mono text-xs">
                  {gateway.bindAddress}:{gateway.httpPort} / {gateway.httpsPort}
                </span>
              </KeyValue>
              <KeyValue label="TLS">
                {gateway.tls.enabled ? (
                  <Badge tone="ok">enabled ({gateway.tls.mode})</Badge>
                ) : (
                  <Badge>disabled</Badge>
                )}
              </KeyValue>
              <KeyValue label="Tailscale">
                {gateway.tailscale.enabled ? (
                  <Badge tone={gateway.tailscale.running ? 'ok' : 'warn'}>
                    {gateway.tailscale.running ? 'running' : 'enabled, not running'}
                  </Badge>
                ) : (
                  <Badge>disabled</Badge>
                )}
              </KeyValue>
              <KeyValue label="Public access">
                {gateway.publicAccess.enabled ? (
                  <Badge tone="warn">{gateway.publicAccess.domain ?? 'enabled'}</Badge>
                ) : (
                  <Badge>disabled</Badge>
                )}
              </KeyValue>
              <KeyValue label="Shared network">
                <span className="font-mono text-xs">
                  {gateway.network.name} · {gateway.network.attached} attached
                </span>
              </KeyValue>
            </dl>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Available URLs"
          description="Read from the labels Traefik itself routes on."
          actions={
            <Button size="sm" onClick={() => navigate('/network')}>
              All routes
            </Button>
          }
        />
        {urls.length === 0 ? (
          <Empty
            title="No service is currently routed"
            hint="A service joins by setting traefik.enable=true and attaching to the shared network."
          />
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
