import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { api } from '../lib/api.ts'
import { Badge } from './ui/badge.tsx'
import { Button } from './ui/button.tsx'
import { Card, CardBody, CardHeader } from './ui/card.tsx'
import { Empty, ErrorBox, KeyValue, Loading } from './shell-bits.tsx'
import { relativeTime } from '../lib/format.ts'

/**
 * What the panel can say about its GitHub connection, and nothing more.
 *
 * No token, no private key and no webhook secret reaches this component,
 * because none of them reaches the API. What is here is whether it is
 * configured, whether it can be reached, what it was granted, how much budget
 * is left and when it last looked.
 */
export function GitHubStatusCard() {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['github'], queryFn: api.github, retry: false })

  const sync = useMutation({
    mutationFn: () => api.syncGitHub(),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['github'] }),
  })

  if (query.isPending) return <Loading label="Reading the GitHub connection" />
  if (query.error) return <ErrorBox error={query.error} />

  const view = query.data!
  const status = view.status

  if (!status.configured) {
    return (
      <Card>
        <CardHeader title="GitHub App" description="Off by default." />
        <Empty
          title="No GitHub App is configured"
          hint="Set GITHUB_APP_ENABLED, GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY_FILE above. See docs/github.md for the App to create and the exact permissions it needs."
        />
      </Card>
    )
  }

  const budget = status.rateLimit

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span>GitHub App</span>
            {status.available ? (
              <Badge tone="ok">connected</Badge>
            ) : (
              <Badge tone="warn">unreachable</Badge>
            )}
          </span>
        }
        description={status.available ? `App ${status.appId} · ${status.apiUrl}` : (status.reason ?? undefined)}
        actions={
          <Button size="sm" disabled={sync.isPending} onClick={() => sync.mutate()}>
            <RefreshCw className={sync.isPending ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
            Sync
          </Button>
        }
      />
      <CardBody>
        {sync.error ? <ErrorBox error={sync.error} /> : null}
        <dl className="divide-y divide-line/60">
          <KeyValue label="Installations">
            {view.installations.length === 0 ? (
              <span className="text-subtle">
                {view.projectionAvailable ? 'none synced yet' : 'the projection is unavailable'}
              </span>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {view.installations.map((installation) => (
                  <Badge
                    key={installation.installationId}
                    tone={installation.suspended ? 'warn' : 'outline'}
                  >
                    {installation.accountLogin}
                    {installation.suspended ? ' (suspended)' : ''}
                  </Badge>
                ))}
              </div>
            )}
          </KeyValue>
          <KeyValue label="Repositories">{view.repositoryCount}</KeyValue>
          <KeyValue label="Rate limit">
            {budget.remaining === null ? (
              <span className="text-subtle">not read yet</span>
            ) : (
              <span className="tabular-nums">
                {budget.remaining}
                {budget.limit === null ? '' : ` / ${budget.limit}`} left
                {budget.resetAt === null ? '' : `, resets ${relativeTime(budget.resetAt)}`}
              </span>
            )}
          </KeyValue>
          <KeyValue label="Last sync">
            {view.sync.length === 0 ? (
              <span className="text-subtle">never</span>
            ) : (
              <div className="space-y-0.5 text-xs">
                {view.sync.map((entry) => (
                  <div key={entry.scope}>
                    <span className="font-mono">{entry.scope}</span>{' '}
                    <span className="text-subtle">
                      {entry.lastSyncedAt === null ? 'never' : relativeTime(entry.lastSyncedAt)}
                    </span>
                    {entry.lastError ? <span className="ml-2 text-danger">{entry.lastError}</span> : null}
                  </div>
                ))}
              </div>
            )}
          </KeyValue>
        </dl>
        <p className="mt-3 text-xs text-subtle">
          The projection is read from the panel’s own database, so this list answers while GitHub is
          unreachable. No token, key or webhook secret is ever returned by the API.
        </p>
      </CardBody>
    </Card>
  )
}
