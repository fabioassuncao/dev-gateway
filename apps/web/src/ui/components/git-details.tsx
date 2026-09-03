import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { GitBranch } from 'lucide-react'
import { api } from '../lib/api.ts'
import { useFormat } from '../lib/use-format.ts'
import { Badge } from './ui/badge.tsx'
import { Card, CardBody, CardHeader } from './ui/card.tsx'
import { Empty, KeyValue, Loading } from './shell-bits.tsx'
import { Mono } from './copy.tsx'
import { NotCollected, PullRequest } from './git-card.tsx'
import type { ProjectGit } from '../../shared/types.ts'

export function GitDetails({ project }: { project: string }) {
  const { t } = useTranslation('environments', { keyPrefix: 'git' })
  const query = useQuery({
    queryKey: ['environment-git', project],
    queryFn: () => api.environmentGit(project),
    staleTime: 30_000,
  })

  if (query.isPending) return <Loading label={t('reading')} />

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
          title={t('noRepository')}
          hint={data.reason ?? t('noRepositoryHint')}
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
  const { t } = useTranslation('environments', { keyPrefix: 'git' })
  const { relativeTime } = useFormat()
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
              <Badge tone="warn">{t('detachedHead')}</Badge>
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
                {t('uncommittedChanges', {
                  count: changed,
                })}
              </Badge>
            ) : (
              <Badge tone="ok">{t('clean')}</Badge>
            )}
          </span>
        }
        description={
          data.stale
            ? t('collectedStale', {
                time: relativeTime(data.collectedAt),
                seconds: data.staleAfterSeconds,
              })
            : t('collectedAt', {
                time: relativeTime(data.collectedAt),
              })
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
          {head.author ? <KeyValue label={t('author')}>{head.author}</KeyValue> : null}
          <KeyValue label={t('workingTree')}>
            <span className="flex flex-wrap items-center gap-1.5">
              <Badge tone={git.staged > 0 ? 'warn' : 'outline'}>
                {t('staged', { count: git.staged })}
              </Badge>
              <Badge tone={git.unstaged > 0 ? 'warn' : 'outline'}>
                {t('unstaged', { count: git.unstaged })}
              </Badge>
              <Badge tone={git.untracked > 0 ? 'warn' : 'outline'}>
                {t('untracked', { count: git.untracked })}
              </Badge>
              <Badge tone={git.unmerged > 0 ? 'danger' : 'outline'}>
                {t('unmerged', { count: git.unmerged })}
              </Badge>
            </span>
          </KeyValue>
          <KeyValue label={t('upstream')}>
            {git.upstream ? (
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-xs">{git.upstream}</span>
                <Badge tone={git.ahead > 0 ? 'accent' : 'outline'}>
                  {t('ahead', { count: git.ahead })}
                </Badge>
                <Badge tone={git.behind > 0 ? 'warn' : 'outline'}>
                  {t('behind', { count: git.behind })}
                </Badge>
              </span>
            ) : (
              <span className="text-subtle">{t('noUpstream')}</span>
            )}
          </KeyValue>
          {data.remote ? (
            <KeyValue label={t('remote')}>
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
            <KeyValue label={t('scannedDirectory')}>
              <Mono value={data.workingDir} />
            </KeyValue>
          ) : null}
          <KeyValue label={t('refreshOnHost')}>
            <Mono value={data.refreshCommand} />
          </KeyValue>
        </dl>
      </CardBody>
    </Card>
  )
}

function PullRequestsCard({ data }: { data: ProjectGit }) {
  const { t } = useTranslation('environments', { keyPrefix: 'git' })
  const { relativeTime } = useFormat()
  const forge = data.forge

  return (
    <Card>
      <CardHeader
        title={t('openPullRequestsTitle')}
        description={
          forge
            ? t('collectedFrom', {
                time: relativeTime(forge.collectedAt),
                kind: forge.kind,
              })
            : undefined
        }
      />
      {!forge || !forge.authenticated ? (
        <Empty
          title={t('noPullRequestsCollected')}
          hint={
            forge?.reason ??
            t('noPullRequestsHint')
          }
        />
      ) : forge.pulls.length === 0 ? (
        <Empty title={t('noOpenPullRequests')} />
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
