import { useTranslation } from 'react-i18next'
import { Globe } from 'lucide-react'
import type { ProjectDomain } from 'portta-contracts'
import { Badge } from './ui/badge.tsx'
import { Card, CardBody, CardHeader } from './ui/card.tsx'
import { Callout, KeyValue, NoValue } from './shell-bits.tsx'
import { CodeChip, CopyButton, Mono } from './copy.tsx'

/**
 * What the chosen mode actually produces.
 *
 * The settings fields above this card are the variables; this is the answer
 * they add up to. Showing the hostname a project will really get is the whole
 * point: the failure this feature exists to fix was a panel confidently
 * advertising `demo-web.localhost` to somebody reading it from another country.
 */
export function ProjectDomainCard({ domain }: { domain: ProjectDomain }) {
  const { t } = useTranslation('settings', { keyPrefix: 'projectDomain' })

  const tone = domain.problem ? 'danger' : domain.advice ? 'warn' : 'ok'
  const state = domain.problem
    ? t('stateBroken')
    : domain.advice
      ? t('stateLimited')
      : t('stateOk')

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <Globe className="size-4 text-subtle" />
            <span>{t('title')}</span>
            <Badge tone={tone}>{state}</Badge>
          </span>
        }
        description={t('description')}
      />
      <CardBody>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <KeyValue label={t('mode')}>{domain.mode}</KeyValue>
          <KeyValue label={t('base')}>
            <Mono kind="host" tone="ink">{domain.domain}</Mono>
          </KeyValue>
          {domain.mode === 'auto' ? (
            <>
              <KeyValue label={t('publicIp')}>
                {domain.publicIp ? <Mono kind="host" tone="ink">{domain.publicIp}</Mono> : <NoValue />}
              </KeyValue>
              <KeyValue label={t('provider')}>{domain.provider}</KeyValue>
            </>
          ) : null}
        </dl>

        <div className="mt-4">
          <p className="mb-1 text-xs text-subtle">
            {t('examples')}
          </p>
          <ul className="space-y-1">
            {domain.examples.map((example) => (
              <li key={example} className="flex items-center gap-2">
                <CodeChip>{example}</CodeChip>
                <CopyButton value={example} label={example} />
              </li>
            ))}
          </ul>
        </div>

        {domain.problem ? (
          <Callout tone="danger" className="mt-4">{domain.problem}</Callout>
        ) : null}

        {domain.advice ? (
          <Callout tone="warn" className="mt-2">{domain.advice}</Callout>
        ) : null}

        {/* A hostname is a name. Who may reach a service is a separate,
            deliberate setting, and saying so here stops the two being
            confused. See docs/adr/0022-project-domain-modes.md. */}
        <p className="mt-3 text-xs text-subtle">
          {t('note')}
        </p>
      </CardBody>
    </Card>
  )
}
