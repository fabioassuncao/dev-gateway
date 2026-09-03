import { useTranslation } from 'react-i18next'
import type { ContainerState, EndpointScope, Health, Ownership, UrlScope } from '../../shared/types.ts'
import { Badge } from './ui/badge.tsx'
import { cn } from '../lib/utils.ts'

const STATE_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'neutral'> = {
  running: 'ok',
  restarting: 'warn',
  paused: 'warn',
  created: 'neutral',
  removing: 'warn',
  exited: 'neutral',
  dead: 'danger',
  absent: 'neutral',
}

export function StateDot({ state, health }: { state: ContainerState | 'absent'; health?: Health }) {
  const { t } = useTranslation('common')
  const tone = health === 'unhealthy' ? 'danger' : health === 'starting' ? 'warn' : STATE_TONE[state] ?? 'neutral'
  const color =
    tone === 'ok' ? 'bg-ok' : tone === 'warn' ? 'bg-warn' : tone === 'danger' ? 'bg-danger' : 'bg-subtle'
  const stateLabel = t(`state.${state}`, { defaultValue: state })
  const healthLabel = health && health !== 'none' ? t(`health.${health}`, { defaultValue: health }) : null
  return (
    <span
      className={cn('inline-block h-2 w-2 shrink-0 rounded-full', color)}
      title={healthLabel ? `${stateLabel} (${healthLabel})` : stateLabel}
    />
  )
}

export function StateBadge({ state, health, completed }: { state: ContainerState | 'absent'; health?: Health; completed?: boolean }) {
  const { t } = useTranslation('common')
  // A one-shot that exited 0 is not "exited" the way a crashed service is.
  if (completed && state === 'exited') return <Badge tone="neutral">{t('state.completed')}</Badge>
  const stateLabel = t(`state.${state}`, { defaultValue: state })
  const healthLabel = health && health !== 'none' ? t(`health.${health}`, { defaultValue: health }) : null
  const label = healthLabel && state === 'running' ? `${stateLabel} · ${healthLabel}` : stateLabel
  const tone =
    health === 'unhealthy' ? 'danger' : health === 'starting' ? 'warn' : STATE_TONE[state] ?? 'neutral'
  return <Badge tone={tone}>{label}</Badge>
}

/**
 * The single most important distinction in the panel: what the gateway manages,
 * and what merely happens to be running on the same host.
 */
export function OwnershipBadge({ ownership }: { ownership: Ownership }) {
  const { t } = useTranslation('common')
  const tone =
    ownership === 'gateway' ? 'accent' : ownership === 'integrated' ? 'info' : ownership === 'external' ? 'neutral' : 'outline'
  return <Badge tone={tone}>{t(`ownership.${ownership}`)}</Badge>
}

const SCOPE_TONE: Record<EndpointScope | UrlScope, 'neutral' | 'info' | 'warn'> = {
  internal: 'neutral',
  local: 'neutral',
  lan: 'info',
  private: 'info',
  vpn: 'info',
  protected: 'warn',
  public: 'warn',
}

export function ScopeBadge({ scope }: { scope: EndpointScope | UrlScope }) {
  const { t } = useTranslation('common')
  return <Badge tone={SCOPE_TONE[scope]}>{t(`scope.${scope}`)}</Badge>
}
