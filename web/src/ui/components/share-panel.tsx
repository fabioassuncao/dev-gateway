import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Share2 } from 'lucide-react'
import { api } from '../lib/api.ts'
import { expiresIn } from '../lib/format.ts'
import { Badge } from './ui/badge.tsx'
import { Button } from './ui/button.tsx'
import { AddressLine } from './copy.tsx'
import type { ContainerSummary, Share } from '../../shared/types.ts'

const TTLS = [
  { label: '1 hour', seconds: 3600 },
  { label: '4 hours', seconds: 4 * 3600 },
  { label: '24 hours', seconds: 24 * 3600 },
]

/**
 * Exposure for one service: private, public, or protected, with an expiry.
 *
 * "Private" is the absence of a share rather than a deny rule, so the default
 * state here is the only one that exists today. A share is an additional
 * hostname; the project's own router is never touched.
 */
export function SharePanel({ container }: { container: ContainerSummary }) {
  const queryClient = useQueryClient()
  const [password, setPassword] = useState<string | null>(null)
  const [ttl, setTtl] = useState(TTLS[1]!.seconds)

  const query = useQuery({ queryKey: ['shares'], queryFn: api.shares })
  const share = query.data?.shares.find((entry) => entry.container === container.name) ?? null

  const done = () => {
    setPassword(null)
    void queryClient.invalidateQueries({ queryKey: ['shares'] })
    void queryClient.invalidateQueries({ queryKey: ['status'] })
  }

  const create = useMutation({
    mutationFn: (mode: 'public' | 'protected') =>
      api.createShare(container.id, { mode, ttlSeconds: ttl }),
    onSuccess: (result) => {
      setPassword(result.password)
      void queryClient.invalidateQueries({ queryKey: ['shares'] })
      void queryClient.invalidateQueries({ queryKey: ['status'] })
    },
  })
  const regenerate = useMutation({
    mutationFn: (id: string) => api.regenerateShare(id),
    onSuccess: (result) => {
      setPassword(result.password)
      void queryClient.invalidateQueries({ queryKey: ['shares'] })
    },
  })
  const revoke = useMutation({ mutationFn: (id: string) => api.revokeShare(id), onSuccess: done })

  const error = create.error ?? regenerate.error ?? revoke.error

  return (
    <div className="space-y-2 text-xs">
      {share ? (
        <ActiveShare
          share={share}
          onRevoke={() => revoke.mutate(share.id)}
          onRegenerate={() => regenerate.mutate(share.id)}
          busy={revoke.isPending || regenerate.isPending}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Badge>private</Badge>
          <span className="text-subtle">Reachable only where it already is.</span>
          <select
            className="rounded border border-line bg-surface px-1.5 py-1 text-xs"
            value={ttl}
            onChange={(event) => setTtl(Number(event.target.value))}
            aria-label="Share expires after"
          >
            {TTLS.map((option) => (
              <option key={option.seconds} value={option.seconds}>
                {option.label}
              </option>
            ))}
          </select>
          <Button size="sm" disabled={create.isPending} onClick={() => create.mutate('protected')}>
            <Share2 className="h-3.5 w-3.5" />
            Share with a password
          </Button>
          {query.data?.publicAllowed ? (
            <Button size="sm" disabled={create.isPending} onClick={() => create.mutate('public')}>
              Share publicly
            </Button>
          ) : null}
        </div>
      )}

      {password ? (
        <div className="rounded border border-warn/40 bg-warn/10 px-2 py-1.5">
          <div className="font-medium">
            Password: <span className="font-mono">{password}</span>
          </div>
          <div className="text-subtle">
            This is the only time it is shown. Only its hash is stored, here and in Traefik.
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="text-danger">
          {error.message}
          {'hint' in error && error.hint ? <div className="text-subtle">{String(error.hint)}</div> : null}
        </div>
      ) : null}
    </div>
  )
}

function ActiveShare({
  share,
  onRevoke,
  onRegenerate,
  busy,
}: {
  share: Share
  onRevoke: () => void
  onRegenerate: () => void
  busy: boolean
}) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={share.mode === 'public' ? 'danger' : 'warn'}>{share.mode}</Badge>
        {share.user ? <span className="font-mono text-muted">{share.user}</span> : null}
        <Badge tone={share.state === 'active' ? 'outline' : 'danger'}>
          {share.state === 'expired'
            ? 'expired'
            : share.state === 'dangling'
              ? 'target is gone'
              : `expires ${expiresIn(share.expiresAt)}`}
        </Badge>
      </div>
      <AddressLine value={share.url} href={share.url} />
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={onRevoke}>
          Revoke
        </Button>
        {share.mode === 'protected' ? (
          <Button size="sm" disabled={busy} onClick={onRegenerate}>
            Regenerate password
          </Button>
        ) : null}
      </div>
    </div>
  )
}
