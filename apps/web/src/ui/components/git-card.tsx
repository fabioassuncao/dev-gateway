import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { GitBranch, GitPullRequest } from 'lucide-react'
import { api } from '../lib/api.ts'
import { useFormat } from '../lib/use-format.ts'
import { Badge } from './ui/badge.tsx'
import type { ForgePullRequest, ProjectGit } from '../../shared/types.ts'

export function GitCard({ project }: { project: string }) {
  const query = useQuery({
    queryKey: ['project-git', project],
    queryFn: () => api.projectGit(project),
    staleTime: 30_000,
  })

  const data = query.data
  if (!data) return null

  if (!data.collected) return <NotCollected data={data} />
  if (!data.git) return null

  return (
    <>
      <GitRow data={data} />
      <ForgeRow data={data} />
    </>
  )
}

export function NotCollected({ data }: { data: ProjectGit }) {
  const { t } = useTranslation('gateway', { keyPrefix: 'project.git' })

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-4 py-2 text-xs text-subtle">
      <GitBranch className="h-3.5 w-3.5" />
      <span>{t('empty')}.</span>
      <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono">{data.refreshCommand}</code>
    </div>
  )
}

export function ForgeRow({ data }: { data: ProjectGit }) {
  const { t } = useTranslation('gateway', { keyPrefix: 'project.git' })
  const forge = data.forge
  if (!forge || !forge.authenticated) return null

  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line px-4 py-2 text-xs">
      <span className="flex items-center gap-1.5 text-muted">
        <GitPullRequest className="h-3.5 w-3.5" />
        <span className="font-medium text-ink">
          {forge.pulls.length === 0
            ? t('noOpenPullRequests', { defaultValue: 'No open pull requests' })
            : forge.pulls.length === 1
              ? t('oneOpenPullRequest', { defaultValue: '1 open pull request' })
              : t('openPullRequests', {
                  defaultValue: '{{count}} open pull requests',
                  count: forge.pulls.length,
                })}
        </span>
      </span>
      {forge.pulls.slice(0, 4).map((pull) => (
        <PullRequest key={pull.number} pull={pull} />
      ))}
    </div>
  )
}

export function PullRequest({ pull }: { pull: ForgePullRequest }) {
  const { t } = useTranslation('gateway', { keyPrefix: 'project.git' })
  const review =
    pull.reviewDecision === 'APPROVED'
      ? { tone: 'ok' as const, label: t('approved', { defaultValue: 'approved' }) }
      : pull.reviewDecision === 'CHANGES_REQUESTED'
        ? { tone: 'danger' as const, label: t('changesRequested', { defaultValue: 'changes requested' }) }
        : pull.reviewDecision === 'REVIEW_REQUIRED'
          ? { tone: 'warn' as const, label: t('reviewRequested', { defaultValue: 'review requested' }) }
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
      {pull.draft ? <Badge>{t('draft', { defaultValue: 'draft' })}</Badge> : null}
      {review ? <Badge tone={review.tone}>{review.label}</Badge> : null}
      {pull.checks === 'failing' ? (
        <Badge tone="danger">{t('checksFailing', { defaultValue: 'checks failing' })}</Badge>
      ) : pull.checks === 'pending' ? (
        <Badge tone="warn">{t('checksPending', { defaultValue: 'checks pending' })}</Badge>
      ) : pull.checks === 'passing' ? (
        <Badge tone="ok">{t('checksPassing', { defaultValue: 'checks passing' })}</Badge>
      ) : null}
    </span>
  )
}

export function GitRow({ data }: { data: ProjectGit }) {
  const { t } = useTranslation('gateway', { keyPrefix: 'project.git' })
  const { relativeTime } = useFormat()
  const git = data.git!
  const head = git.head
  const changed = git.staged + git.unstaged + git.untracked + git.unmerged

  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line px-4 py-2 text-xs">
      <span className="flex items-center gap-1.5 text-muted">
        <GitBranch className="h-3.5 w-3.5" />
        {git.detached ? (
          <Badge tone="warn">{t('detachedHead', { defaultValue: 'detached HEAD' })}</Badge>
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
            {t('uncommittedChanges', {
              defaultValue: '{{count}} uncommitted changes',
              count: changed,
            })}
          </Badge>
        ) : (
          <Badge tone="ok">{t('clean', { defaultValue: 'clean' })}</Badge>
        )}
        {git.ahead > 0 ? (
          <Badge tone="outline">{t('ahead', { defaultValue: '{{count}} ahead', count: git.ahead })}</Badge>
        ) : null}
        {git.behind > 0 ? (
          <Badge tone="outline">{t('behind', { defaultValue: '{{count}} behind', count: git.behind })}</Badge>
        ) : null}
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
        <span title={data.stale ? t('staleHint', { seconds: data.staleAfterSeconds, defaultValue: 'older than {{seconds}}s' }) : undefined}>
          {data.stale ? (
            <Badge tone="warn">
              {t('collectedAgo', {
                defaultValue: 'collected {{time}}',
                time: relativeTime(data.collectedAt),
              })}
            </Badge>
          ) : (
            <>
              {t('collectedAgo', {
                defaultValue: 'collected {{time}}',
                time: relativeTime(data.collectedAt),
              })}
            </>
          )}
        </span>
      </span>
    </div>
  )
}
