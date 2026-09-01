import type { ContainerState, Health, Ownership, UrlScope } from '../../shared/types.ts'
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
  const tone = health === 'unhealthy' ? 'danger' : health === 'starting' ? 'warn' : STATE_TONE[state] ?? 'neutral'
  const color =
    tone === 'ok' ? 'bg-ok' : tone === 'warn' ? 'bg-warn' : tone === 'danger' ? 'bg-danger' : 'bg-subtle'
  return (
    <span
      className={cn('inline-block h-2 w-2 shrink-0 rounded-full', color)}
      title={health && health !== 'none' ? `${state} (${health})` : state}
    />
  )
}

export function StateBadge({ state, health }: { state: ContainerState | 'absent'; health?: Health }) {
  const label = health && health !== 'none' && state === 'running' ? `${state} · ${health}` : state
  const tone =
    health === 'unhealthy' ? 'danger' : health === 'starting' ? 'warn' : STATE_TONE[state] ?? 'neutral'
  return <Badge tone={tone}>{label}</Badge>
}

const OWNERSHIP_LABEL: Record<Ownership, string> = {
  gateway: 'Dev Gateway',
  integrated: 'Integrated',
  external: 'External',
  standalone: 'Standalone',
}

/**
 * The single most important distinction in the panel: what the gateway manages,
 * and what merely happens to be running on the same host.
 */
export function OwnershipBadge({ ownership }: { ownership: Ownership }) {
  const tone =
    ownership === 'gateway' ? 'accent' : ownership === 'integrated' ? 'info' : ownership === 'external' ? 'neutral' : 'outline'
  return <Badge tone={tone}>{OWNERSHIP_LABEL[ownership]}</Badge>
}

const SCOPE_TONE: Record<UrlScope, 'neutral' | 'info' | 'warn'> = {
  local: 'neutral',
  vpn: 'info',
  public: 'warn',
}

export function ScopeBadge({ scope }: { scope: UrlScope }) {
  return <Badge tone={SCOPE_TONE[scope]}>{scope === 'vpn' ? 'VPN' : scope}</Badge>
}
