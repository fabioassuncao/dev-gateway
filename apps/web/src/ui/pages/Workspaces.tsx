import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { api, ApiError } from '../lib/api.ts'
import type { WorkspaceSummary } from '../../shared/types.ts'
import { Badge } from '../components/ui/badge.tsx'
import { Button } from '../components/ui/button.tsx'
import { Card, CardHeader } from '../components/ui/card.tsx'
import { Dialog } from '../components/ui/dialog.tsx'
import { Input } from '../components/ui/field.tsx'
import { Empty, ErrorBox, Loading, PageHeader } from '../components/shell-bits.tsx'
import { slug as slugify } from '../../shared/slug.ts'
import { useDocumentTitle } from '../lib/title.ts'

/**
 * The groupings a person created, as opposed to what this host is running.
 *
 * A workspace with nothing up is still a workspace: it owns repositories and,
 * later, issues. That is the whole reason it is persisted rather than derived.
 */
export function Workspaces() {
  const { t } = useTranslation('workspaces')
  useDocumentTitle(t('title'))
  const [creating, setCreating] = useState(false)
  const query = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces, retry: false })

  if (query.isPending) return <Loading />

  const unavailable = query.error instanceof ApiError && query.error.status === 503

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Button variant="primary" disabled={unavailable} onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" />
            {t('newWorkspace')}
          </Button>
        }
      />

      {query.error ? (
        unavailable ? (
          <Card>
            <Empty title={t('needsDatabase')} hint={t('needsDatabaseHint')} />
          </Card>
        ) : (
          <ErrorBox error={query.error} />
        )
      ) : (query.data ?? []).length === 0 ? (
        <Card>
          <Empty title={t('empty')} hint={t('emptyHint')} />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(query.data ?? []).map((workspace) => (
            <WorkspaceCard key={workspace.slug} workspace={workspace} />
          ))}
        </div>
      )}

      {creating ? <CreateWorkspaceDialog open onOpenChange={setCreating} /> : null}
    </>
  )
}

function WorkspaceCard({ workspace }: { workspace: WorkspaceSummary }) {
  const { t } = useTranslation('workspaces')
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <a
              className="underline-offset-2 hover:text-accent hover:underline"
              href={`#/workspaces/${encodeURIComponent(workspace.slug)}`}
            >
              {workspace.name}
            </a>
            {workspace.archived ? <Badge tone="outline">{t('archived')}</Badge> : null}
          </span>
        }
        description={workspace.description ?? undefined}
      />
      <div className="flex flex-wrap items-center gap-1.5 px-4 py-3">
        <Badge tone="outline">
          {t(workspace.repositoryCount === 1 ? 'repository' : 'repositories', {
            count: workspace.repositoryCount,
          })}
        </Badge>
        <Badge tone={workspace.runningEnvironmentCount > 0 ? 'ok' : 'neutral'}>
          {t('running', {
            running: workspace.runningEnvironmentCount,
            total: workspace.environmentCount,
          })}
        </Badge>
      </div>
    </Card>
  )
}

function CreateWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('workspaces')
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')

  const create = useMutation({
    mutationFn: () =>
      api.createWorkspace({
        name: name.trim(),
        slug: (slug.trim() === '' ? slugify(name) : slug.trim()),
        description: description.trim() === '' ? null : description.trim(),
      }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      onOpenChange(false)
      window.location.hash = `/workspaces/${encodeURIComponent(created.slug)}`
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('create.title')}
      description={t('create.description')}
      footer={
        <Button
          variant="primary"
          size="sm"
          disabled={name.trim() === '' || create.isPending}
          onClick={() => create.mutate()}
        >
          {t('create.create')}
        </Button>
      }
    >
      {create.error ? <ErrorBox error={create.error} /> : null}
      <div className="space-y-3">
        <label className="block">
          <span className="text-xs text-subtle">{t('create.name')}</span>
          <Input value={name} onChange={(event) => setName(event.target.value)} aria-label={t('create.name')} />
        </label>
        <label className="block">
          <span className="text-xs text-subtle">{t('create.slug')}</span>
          <Input
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            placeholder={name.trim() === '' ? 'meu-produto' : slugify(name)}
            aria-label={t('create.slug')}
          />
          <span className="mt-0.5 block text-[11px] text-subtle">{t('create.slugHint')}</span>
        </label>
        <label className="block">
          <span className="text-xs text-subtle">{t('create.descriptionLabel')}</span>
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            aria-label={t('create.descriptionLabel')}
          />
        </label>
      </div>
    </Dialog>
  )
}
