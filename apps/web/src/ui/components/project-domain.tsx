import { useTranslation } from 'react-i18next'
import { Globe, TriangleAlert } from 'lucide-react'
import type { ProjectDomain } from '../../shared/types.ts'
import { Badge } from './ui/badge.tsx'
import { Card, CardBody, CardHeader } from './ui/card.tsx'
import { KeyValue } from './shell-bits.tsx'
import { CopyButton } from './copy.tsx'

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
    ? t('stateBroken', { defaultValue: 'not resolvable' })
    : domain.advice
      ? t('stateLimited', { defaultValue: 'needs attention' })
      : t('stateOk', { defaultValue: 'usable' })

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <Globe className="h-4 w-4" />
            <span>{t('title', { defaultValue: 'Project hostnames' })}</span>
            <Badge tone={tone}>{state}</Badge>
          </span>
        }
        description={t('description', {
          defaultValue: 'Every project gets <project>-<service>.<base>. This is the base in use right now.',
        })}
      />
      <CardBody>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <KeyValue label={t('mode', { defaultValue: 'Mode' })}>{domain.mode}</KeyValue>
          <KeyValue label={t('base', { defaultValue: 'Base domain' })}>
            <span className="font-mono">{domain.domain}</span>
          </KeyValue>
          {domain.mode === 'auto' ? (
            <>
              <KeyValue label={t('publicIp', { defaultValue: 'Public address' })}>
                <span className="font-mono">{domain.publicIp ?? '—'}</span>
              </KeyValue>
              <KeyValue label={t('provider', { defaultValue: 'Wildcard DNS' })}>{domain.provider}</KeyValue>
            </>
          ) : null}
        </dl>

        <div className="mt-4">
          <p className="mb-1 text-xs text-subtle">
            {t('examples', { defaultValue: 'A project called web, api or mail would answer on:' })}
          </p>
          <ul className="space-y-1">
            {domain.examples.map((example) => (
              <li key={example} className="flex items-center gap-2">
                <code className="font-mono text-sm">{example}</code>
                <CopyButton value={example} label={example} />
              </li>
            ))}
          </ul>
        </div>

        {domain.problem ? (
          <p className="mt-4 flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{domain.problem}</span>
          </p>
        ) : null}

        {domain.advice ? (
          <p className="mt-2 flex items-start gap-2 rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-sm text-warn">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{domain.advice}</span>
          </p>
        ) : null}

        {/* A hostname is a name. Who may reach a service is a separate,
            deliberate setting, and saying so here stops the two being
            confused. See docs/adr/0022-project-domain-modes.md. */}
        <p className="mt-3 text-xs text-subtle">
          {t('note', {
            defaultValue:
              'This chooses the name only. Which services are reachable, and from where, stays with public access and each project.',
          })}
        </p>
      </CardBody>
    </Card>
  )
}
