import { useTranslation } from 'react-i18next'
import { ExternalLink, TriangleAlert } from 'lucide-react'
import { useGateway } from '../lib/queries/index.ts'
import { Badge } from './ui/badge.tsx'
import { Button } from './ui/button.tsx'
import { Card, CardBody, CardHeader } from './ui/card.tsx'
import { CopyButton } from './copy.tsx'
import { ScopeBadge } from './status.tsx'
import { primaryUsable } from './dashboard-card-lib.ts'

export function DashboardCard() {
  const { t } = useTranslation('settings', { keyPrefix: 'dashboard' })
  const { t: tc } = useTranslation('common')
  const query = useGateway()
  const dashboard = query.data?.dashboard
  if (!dashboard) return null

  const primary = primaryUsable(dashboard.endpoints)
  const tailnetHole =
    query.data?.tailscale.enabled && dashboard.enabled && dashboard.expose === 'local'

  return (
    <Card>
      <CardHeader
        title={t('title')}
        description={t('description')}
      />
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={dashboard.enabled ? 'ok' : 'neutral'}>
            {dashboard.enabled ? tc('enabled') : tc('disabled')}
          </Badge>
          {dashboard.enabled ? <Badge>{dashboard.expose}</Badge> : null}
          {dashboard.expose === 'domain' ? (
            <Badge tone={dashboard.authenticated ? 'ok' : 'danger'}>
              {dashboard.authenticated ? t('authenticated') : t('noCredential')}
            </Badge>
          ) : dashboard.enabled ? (
            <Badge>{t('loopbackOnly')}</Badge>
          ) : null}
        </div>

        {dashboard.endpoints.filter((entry) => entry.scope !== 'internal').map((endpoint) => (
          <div key={`${endpoint.provider}:${endpoint.url}`} className="flex min-w-0 flex-wrap items-center gap-1.5">
            <ScopeBadge scope={endpoint.scope} />
            {endpoint.usable ? (
              <>
                <span className="font-mono text-xs text-ink">{endpoint.url}</span>
                <CopyButton value={endpoint.url} label={t('copyAddress')} />
              </>
            ) : (
              <span className="text-xs text-subtle">{endpoint.problem ?? endpoint.url}</span>
            )}
          </div>
        ))}

        {dashboard.enabled && dashboard.expose === 'local' && dashboard.advertisedHost === null ? (
          <p className="text-xs text-subtle">{t('loopbackHint')}</p>
        ) : null}

        {tailnetHole ? (
          <p className="flex items-start gap-1.5 text-xs text-warn">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{t('tailnetWarning')}</span>
          </p>
        ) : null}

        <Button
          size="sm"
          variant="primary"
          disabled={!primary}
          title={primary ? t('open') : t('openDisabled')}
          onClick={() => {
            if (primary) window.open(primary.url, '_blank', 'noreferrer')
          }}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {t('open')}
        </Button>
      </CardBody>
    </Card>
  )
}
