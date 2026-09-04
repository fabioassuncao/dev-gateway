import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ExternalLink } from 'lucide-react'
import { api, ApiError } from '../lib/api/index.ts'
import { keys, useProject, useRepository, useRepositoryCommits, useRepositoryEnvironments, useRepositoryGit, useRepositoryInstructions } from '../lib/queries/index.ts'
import { environmentHealth, healthTone } from '../lib/health.ts'
import { useFormat } from '../lib/use-format.ts'
import { useDocumentTitle } from '../lib/title.ts'
import { navigate } from '../lib/router.ts'
import type { Repository, RepositoryGit } from 'portta-contracts'
import { StatusIndicator } from '../components/ui/badge.tsx'
import { narrowTone } from '../lib/tone.ts'
import { Button } from '../components/ui/button.tsx'
import { Card, CardHeader } from '../components/ui/card.tsx'
import { Dialog } from '../components/ui/dialog.tsx'
import { Tabs, TabPanel, type TabDefinition } from '../components/ui/tabs.tsx'
import { Callout, Empty, ErrorBox, Loading, PageHeader } from '../components/shell-bits.tsx'
import type { BreadcrumbItem } from '../components/ui/breadcrumb.tsx'
import { Mono } from '../components/copy.tsx'
import { EndpointList } from '../components/entities/endpoint-list.tsx'
import { CommitRow } from '../components/entities/commit-row.tsx'
import { InstructionsPanel } from '../components/entities/instructions-panel.tsx'
import { PullRequestRow } from '../components/entities/pull-request-row.tsx'
import { RepositoryDetail } from '../components/entities/repository-detail.tsx'
import { repositoryHref } from '../components/entities/repository-row.tsx'

const TABS = ['overview', 'commits', 'instructions'] as const
export type RepositoryTab = (typeof TABS)[number]

export function resolveRepositoryTab(requested: string | null): RepositoryTab {
  return TABS.includes(requested as RepositoryTab) ? (requested as RepositoryTab) : 'overview'
}

/**
 * One repository of a Project: what code is checked out, what changed
 * recently, what is running from it, and what an agent reads before it works.
 */
export function RepositoryPage({ slug, id, tab: requested }: { slug: string; id: string; tab: string | null }) {
  const { t } = useTranslation('repositories', { keyPrefix: 'page' })
  const tab = resolveRepositoryTab(requested)
  const query = useRepository(id)
  const git = useRepositoryGit(id, query.isSuccess)
  const project = useProject(slug)
  useDocumentTitle(query.data?.name ?? id, tab === 'overview' ? null : t(`tabs.${tab}`), project.data?.name)

  if (query.isPending) return <Loading />
  if (query.error) {
    const missing = query.error instanceof ApiError && query.error.status === 404
    if (!missing) return <ErrorBox error={query.error} />
    return (
      <>
        <PageHeader title={id} />
        <Card>
          <Empty title={t('notFound', { id })} hint={<a className="rounded-xs text-accent hover:underline focus-ring" href={`#/projects/${encodeURIComponent(slug)}`}>{t('backToProject')}</a>} />
        </Card>
      </>
    )
  }

  const repository = query.data!
  const tabs: TabDefinition[] = TABS.map((entry) => ({ id: entry, label: t(`tabs.${entry}`), href: repositoryHref(slug, id, entry).slice(1) }))

  return (
    <>
      <RepositoryHeader repository={repository} slug={slug} git={git.data ?? null} project={{ name: project.data?.name ?? slug, pending: project.isPending }} />
      <Tabs tabs={tabs} active={tab} label={`${repository.name} sections`} />
      <TabPanel id={tab}>
        {tab === 'overview' ? <OverviewTab repository={repository} git={git.data ?? null} slug={slug} /> : null}
        {tab === 'commits' ? <CommitsTab id={id} /> : null}
        {tab === 'instructions' ? <InstructionsTab id={id} /> : null}
      </TabPanel>
    </>
  )
}

function RepositoryHeader({ repository, slug, git, project }: { repository: Repository; slug: string; git: RepositoryGit | null; project: { name: string; pending: boolean } }) {
  const { t } = useTranslation('repositories')
  const { t: tc } = useTranslation('common')
  const { t: tn } = useTranslation('nav')
  const queryClient = useQueryClient()
  const [confirm, setConfirm] = useState(false)
  const remove = useMutation({
    mutationFn: () => api.deleteRepository(repository.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.projects() })
      navigate(`/projects/${encodeURIComponent(slug)}`)
    },
  })
  const path = repository.scanPath ?? repository.localPath
  const base = `#/projects/${encodeURIComponent(slug)}`
  const breadcrumb: BreadcrumbItem[] = [
    { label: tn('projects'), href: '#/projects' },
    { label: project.name, href: base, pending: project.pending },
    { label: t('title'), href: `${base}/repositories` },
    { label: repository.name },
  ]
  return (
    <>
      <PageHeader
        title={repository.name}
        breadcrumb={breadcrumb}
        description={[repository.role, repository.provider !== 'local' ? repository.provider : null, path].filter(Boolean).join(' · ') || undefined}
        actions={
          <>
            {repository.github ? (
              <Button asChild size="sm">
                <a href={repository.github.htmlUrl} target="_blank" rel="noreferrer noopener">
                  GitHub <ExternalLink />
                </a>
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>{t('page.remove')}</Button>
          </>
        }
      />
      {git && !git.collected ? (
        <Callout className="mb-4" title={t('page.notScanned')}>
          {t('page.notScannedHint')} <Mono kind="command" tone="ink" value={git.refreshCommand} />
        </Callout>
      ) : null}
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('page.removeTitle')}
        description={t('page.removeDescription')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>{tc('cancel')}</Button>
            <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>{t('page.remove')}</Button>
          </>
        }
      >
        {remove.error ? <ErrorBox error={remove.error} /> : null}
      </Dialog>
    </>
  )
}

function OverviewTab({ repository, git, slug }: { repository: Repository; git: RepositoryGit | null; slug: string }) {
  const { t } = useTranslation('repositories')
  const { relativeTime } = useFormat()
  const environments = useRepositoryEnvironments(repository.id)
  const forge = git?.forge ?? null
  return (
    <div className="space-y-4">
      <RepositoryDetail repository={repository} git={git} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('pulls.title')} description={forge ? t('pulls.collectedFrom', { time: relativeTime(forge.collectedAt), kind: forge.kind }) : undefined} />
          {!forge || !forge.authenticated ? (
            <Empty title={t('pulls.notCollected')} hint={forge?.reason ?? t('pulls.notCollectedHint')} />
          ) : forge.pulls.length === 0 ? (
            <Empty title={t('pulls.none')} />
          ) : (
            <div className="divide-y divide-line-subtle">
              {forge.pulls.map((pull) => <PullRequestRow key={pull.number} pull={pull} showBranch />)}
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title={t('page.environments.title')} description={t('page.environments.description')} />
          {environments.isPending ? <Loading /> : (environments.data ?? []).length === 0 ? (
            <Empty title={t('page.environments.empty')} />
          ) : (
            <div className="divide-y divide-line-subtle">
              {(environments.data ?? []).map((environment) => (
                <div key={environment.environment} className="flex min-h-9 flex-wrap items-center gap-2 px-3 py-1.5 text-sm hover:bg-fill">
                  <a className="rounded-xs font-medium underline-offset-2 hover:underline focus-ring" href={`#/environments/${encodeURIComponent(environment.environment)}`}>
                    {environment.environment}
                  </a>
                  <StatusIndicator tone={narrowTone(healthTone(environmentHealth(environment)))}>{t('page.running', { running: environment.runningCount, total: environment.serviceCount })}</StatusIndicator>
                  <EndpointList endpoints={environment.urls} compact limit={2} className="min-w-0 flex-1" />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
      <Card>
        <CardHeader
          title={t('instructions.title')}
          description={t('instructions.description')}
          actions={<a className="rounded-xs text-xs text-accent hover:underline focus-ring" href={repositoryHref(slug, repository.id, 'instructions')}>{t('page.tabs.instructions')}</a>}
        />
        <InstructionsPanel files={git?.instructions ?? []} compact />
      </Card>
    </div>
  )
}

function CommitsTab({ id }: { id: string }) {
  const { t } = useTranslation('repositories', { keyPrefix: 'page.commits' })
  const query = useRepositoryCommits(id)
  if (query.isPending) return <Loading />
  if (query.error) return <ErrorBox error={query.error} />
  const data = query.data!
  return (
    <Card>
      <CardHeader title={t('title')} description={data.stale ? t('stale') : t('description')} />
      {data.commits.length === 0 ? <Empty title={t('empty')} /> : (
        <div className="divide-y divide-line-subtle">
          {data.commits.map((commit) => <CommitRow key={commit.sha} commit={commit} />)}
        </div>
      )}
    </Card>
  )
}

function InstructionsTab({ id }: { id: string }) {
  const { t } = useTranslation('repositories', { keyPrefix: 'instructions' })
  const query = useRepositoryInstructions(id)
  if (query.isPending) return <Loading />
  if (query.error) return <ErrorBox error={query.error} />
  return (
    <Card>
      <CardHeader title={t('title')} description={t('description')} />
      <InstructionsPanel files={query.data!.instructions} />
    </Card>
  )
}
