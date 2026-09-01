import { useQuery } from '@tanstack/react-query'
import { GitBranch, GitPullRequest } from 'lucide-react'
import { api } from '../lib/api.ts'
import { relativeTime } from '../lib/format.ts'
import { Badge } from './ui/badge.tsx'
import type { ForgePullRequest, ProjectGit } from '../../shared/types.ts'

/**
 * What the host collected about this project's repository.
 *
 * Nothing here is live, and the card never implies otherwise: the age of the
 * scan is always on screen, anything past the threshold says so, and the
 * command that refreshes it is right there. The panel cannot run it.
 */
export function GitCard({ project }: { project: string }) {
  const query = useQuery({
    queryKey: ['project-git', project],
    queryFn: () => api.projectGit(project),
    // A file on a mount, read on request. There is nothing to poll.
    staleTime: 30_000,
  })

  const data = query.data
  if (!data) return null

  if (!data.collected) return <NotCollected data={data} />
  // A project without Git gets no Git block, which is the whole point of the
  // degradation: fewer sections, never an error.
  if (!data.git) return null

  return (
    <>
      <GitRow data={data} />
      <ForgeRow data={data} />
    </>
  )
}

function NotCollected({ data }: { data: ProjectGit }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-4 py-2 text-xs text-subtle">
      <GitBranch className="h-3.5 w-3.5" />
      <span>No Git metadata collected for this project.</span>
      <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono">{data.refreshCommand}</code>
    </div>
  )
}

/**
 * Open pull requests, when `git scan --with-prs` could ask `gh`. Absent `gh`,
 * a signed-out `gh` and a remote on a forge `gh` cannot talk to all render
 * nothing at all, which is the documented degradation rather than an error.
 */
function ForgeRow({ data }: { data: ProjectGit }) {
  const forge = data.forge
  if (!forge || !forge.authenticated) return null

  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line px-4 py-2 text-xs">
      <span className="flex items-center gap-1.5 text-muted">
        <GitPullRequest className="h-3.5 w-3.5" />
        <span className="font-medium text-ink">
          {forge.pulls.length === 0
            ? 'No open pull requests'
            : `${forge.pulls.length} open pull ${forge.pulls.length === 1 ? 'request' : 'requests'}`}
        </span>
      </span>
      {forge.pulls.slice(0, 4).map((pull) => (
        <PullRequest key={pull.number} pull={pull} />
      ))}
    </div>
  )
}

function PullRequest({ pull }: { pull: ForgePullRequest }) {
  const review =
    pull.reviewDecision === 'APPROVED'
      ? { tone: 'ok' as const, label: 'approved' }
      : pull.reviewDecision === 'CHANGES_REQUESTED'
        ? { tone: 'danger' as const, label: 'changes requested' }
        : pull.reviewDecision === 'REVIEW_REQUIRED'
          ? { tone: 'warn' as const, label: 'review requested' }
          : null

  return (
    <span className="flex items-center gap-1.5">
      {pull.url ? (
        <a
          className="underline-offset-2 hover:text-accent hover:underline"
          href={pull.url}
          target="_blank"
          rel="noreferrer noopener"
        >
          #{pull.number} {pull.title}
        </a>
      ) : (
        <span>
          #{pull.number} {pull.title}
        </span>
      )}
      {pull.draft ? <Badge>draft</Badge> : null}
      {review ? <Badge tone={review.tone}>{review.label}</Badge> : null}
      {pull.checks === 'failing' ? (
        <Badge tone="danger">checks failing</Badge>
      ) : pull.checks === 'pending' ? (
        <Badge tone="warn">checks pending</Badge>
      ) : pull.checks === 'passing' ? (
        <Badge tone="ok">checks passing</Badge>
      ) : null}
    </span>
  )
}

function GitRow({ data }: { data: ProjectGit }) {
  const git = data.git!
  const head = git.head
  const changed = git.staged + git.unstaged + git.untracked + git.unmerged

  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line px-4 py-2 text-xs">
      <span className="flex items-center gap-1.5 text-muted">
        <GitBranch className="h-3.5 w-3.5" />
        {git.detached ? (
          <Badge tone="warn">detached HEAD</Badge>
        ) : data.links.branch ? (
          <a
            className="font-medium text-ink underline-offset-2 hover:text-accent hover:underline"
            href={data.links.branch}
            target="_blank"
            rel="noreferrer noopener"
          >
            {git.branch}
          </a>
        ) : (
          <span className="font-medium text-ink">{git.branch}</span>
        )}
      </span>

      {head.shortSha ? (
        <span className="text-muted">
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
          {head.subject ? <span className="ml-2 text-subtle">{head.subject}</span> : null}
        </span>
      ) : null}

      <span className="flex items-center gap-1.5">
        {changed > 0 ? (
          <Badge tone="warn">
            {changed} uncommitted {changed === 1 ? 'change' : 'changes'}
          </Badge>
        ) : (
          <Badge tone="ok">clean</Badge>
        )}
        {git.ahead > 0 ? <Badge tone="outline">{git.ahead} ahead</Badge> : null}
        {git.behind > 0 ? <Badge tone="outline">{git.behind} behind</Badge> : null}
      </span>

      <span className="ml-auto flex items-center gap-2 text-subtle">
        {data.remote ? (
          <a
            className="underline-offset-2 hover:text-accent hover:underline"
            href={data.remote.repoUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            {data.remote.slug}
          </a>
        ) : null}
        <span title={data.stale ? `older than ${data.staleAfterSeconds}s` : undefined}>
          {data.stale ? (
            <Badge tone="warn">collected {relativeTime(data.collectedAt)}</Badge>
          ) : (
            <>collected {relativeTime(data.collectedAt)}</>
          )}
        </span>
      </span>
    </div>
  )
}
