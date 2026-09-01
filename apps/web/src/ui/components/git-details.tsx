import { useQuery } from '@tanstack/react-query'
import { GitBranch } from 'lucide-react'
import { api } from '../lib/api.ts'
import { relativeTime } from '../lib/format.ts'
import { Badge } from './ui/badge.tsx'
import { Card, CardBody, CardHeader } from './ui/card.tsx'
import { Empty, KeyValue, Loading } from './shell-bits.tsx'
import { Mono } from './copy.tsx'
import { NotCollected, PullRequest } from './git-card.tsx'
import type { ProjectGit } from '../../shared/types.ts'

/**
 * The whole of `ProjectGit`, with the room the project card never had.
 *
 * Still not live, and still not refreshable from here: ADR 0010 puts the scan
 * on the host, so the age and the exact host command stay on screen and there
 * is deliberately no button that would appear to run one.
 */
export function GitDetails({ project }: { project: string }) {
  const query = useQuery({
    queryKey: ['project-git', project],
    queryFn: () => api.projectGit(project),
    staleTime: 30_000,
  })

  if (query.isPending) return <Loading label="Reading collected Git metadata" />

  const data = query.data
  if (!data) return null
  if (!data.collected) {
    return (
      <Card>
        <NotCollected data={data} />
      </Card>
    )
  }
  if (!data.git) {
    return (
      <Card>
        <Empty
          title="This project has no Git repository"
          hint={data.reason ?? 'Nothing was found to scan under this project’s working directory.'}
        />
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <RepositoryCard data={data} />
      <PullRequestsCard data={data} />
    </div>
  )
}

function RepositoryCard({ data }: { data: ProjectGit }) {
  const git = data.git!
  const head = git.head
  const changed = git.staged + git.unstaged + git.untracked + git.unmerged

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <GitBranch className="h-4 w-4 text-muted" />
            {git.detached ? (
              <Badge tone="warn">detached HEAD</Badge>
            ) : data.links.branch ? (
              <a
                className="underline-offset-2 hover:text-accent hover:underline"
                href={data.links.branch}
                target="_blank"
                rel="noreferrer noopener"
              >
                {git.branch}
              </a>
            ) : (
              <span>{git.branch}</span>
            )}
            {changed > 0 ? (
              <Badge tone="warn">
                {changed} uncommitted {changed === 1 ? 'change' : 'changes'}
              </Badge>
            ) : (
              <Badge tone="ok">clean</Badge>
            )}
          </span>
        }
        description={
          data.stale
            ? `Collected ${relativeTime(data.collectedAt)} · older than ${data.staleAfterSeconds}s`
            : `Collected ${relativeTime(data.collectedAt)}`
        }
      />
      <CardBody>
        <dl className="divide-y divide-line/60">
          <KeyValue label="HEAD">
            {data.links.commit ? (
              <a
                className="font-mono underline-offset-2 hover:text-accent hover:underline"
                href={data.links.commit}
                target="_blank"
                rel="noreferrer noopener"
              >
                {head.shortSha}
              </a>
            ) : (
              <span className="font-mono">{head.shortSha}</span>
            )}
            {head.subject ? <span className="ml-2 text-muted">{head.subject}</span> : null}
          </KeyValue>
          {head.author ? <KeyValue label="Author">{head.author}</KeyValue> : null}
          <KeyValue label="Working tree">
            <span className="flex flex-wrap items-center gap-1.5">
              <Badge tone={git.staged > 0 ? 'warn' : 'outline'}>{git.staged} staged</Badge>
              <Badge tone={git.unstaged > 0 ? 'warn' : 'outline'}>{git.unstaged} unstaged</Badge>
              <Badge tone={git.untracked > 0 ? 'warn' : 'outline'}>{git.untracked} untracked</Badge>
              <Badge tone={git.unmerged > 0 ? 'danger' : 'outline'}>{git.unmerged} unmerged</Badge>
            </span>
          </KeyValue>
          <KeyValue label="Upstream">
            {git.upstream ? (
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-xs">{git.upstream}</span>
                <Badge tone={git.ahead > 0 ? 'accent' : 'outline'}>{git.ahead} ahead</Badge>
                <Badge tone={git.behind > 0 ? 'warn' : 'outline'}>{git.behind} behind</Badge>
              </span>
            ) : (
              <span className="text-subtle">No upstream branch</span>
            )}
          </KeyValue>
          {data.remote ? (
            <KeyValue label="Remote">
              <a
                className="underline-offset-2 hover:text-accent hover:underline"
                href={data.remote.repoUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                {data.remote.slug}
              </a>
              <span className="ml-2 text-xs text-subtle">{data.remote.host}</span>
            </KeyValue>
          ) : null}
          {data.workingDir ? (
            <KeyValue label="Scanned directory">
              <Mono value={data.workingDir} />
            </KeyValue>
          ) : null}
          <KeyValue label="Refresh on the host">
            <Mono value={data.refreshCommand} />
          </KeyValue>
        </dl>
      </CardBody>
    </Card>
  )
}

/** Every open pull request, not the first four the card had room for. */
function PullRequestsCard({ data }: { data: ProjectGit }) {
  const forge = data.forge

  return (
    <Card>
      <CardHeader
        title="Open pull requests"
        description={forge ? `Collected ${relativeTime(forge.collectedAt)} from ${forge.kind}` : undefined}
      />
      {!forge || !forge.authenticated ? (
        <Empty
          title="No pull requests were collected"
          hint={
            forge?.reason ??
            'Run dev-gateway git scan --with-prs on the host with gh installed and signed in.'
          }
        />
      ) : forge.pulls.length === 0 ? (
        <Empty title="No open pull requests" />
      ) : (
        <div>
          {forge.pulls.map((pull) => (
            <div key={pull.number} className="border-b border-line px-4 py-2 text-xs last:border-b-0">
              <PullRequest pull={pull} />
              {pull.headRefName ? (
                <div className="mt-0.5 font-mono text-[11px] text-subtle">{pull.headRefName}</div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
