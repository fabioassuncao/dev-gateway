import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
  useDocumentTitle('Workspaces')
  const [creating, setCreating] = useState(false)
  const query = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces, retry: false })

  if (query.isPending) return <Loading />

  const unavailable = query.error instanceof ApiError && query.error.status === 503

  return (
    <>
      <PageHeader
        title="Workspaces"
        description="What you are working on: repositories, and the environments that belong to them."
        actions={
          <Button variant="primary" disabled={unavailable} onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" />
            New workspace
          </Button>
        }
      />

      {query.error ? (
        unavailable ? (
          <Card>
            <Empty
              title="Workspaces need the panel's database"
              hint="They are decisions rather than observations, so they are persisted. Start PostgreSQL and this page comes back; every Docker-backed page works without it."
            />
          </Card>
        ) : (
          <ErrorBox error={query.error} />
        )
      ) : (query.data ?? []).length === 0 ? (
        <Card>
          <Empty
            title="No workspace yet"
            hint="A workspace groups the repositories of one product and the environments running for it. Create one, then attach repositories the GitHub App was granted."
          />
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
            {workspace.archived ? <Badge tone="outline">archived</Badge> : null}
          </span>
        }
        description={workspace.description ?? undefined}
      />
      <div className="flex flex-wrap items-center gap-1.5 px-4 py-3">
        <Badge tone="outline">
          {workspace.repositoryCount} {workspace.repositoryCount === 1 ? 'repository' : 'repositories'}
        </Badge>
        <Badge tone={workspace.runningEnvironmentCount > 0 ? 'ok' : 'neutral'}>
          {workspace.runningEnvironmentCount}/{workspace.environmentCount} running
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
      title="New workspace"
      description="A name and a slug. Repositories and environments are attached afterwards."
      footer={
        <Button
          variant="primary"
          size="sm"
          disabled={name.trim() === '' || create.isPending}
          onClick={() => create.mutate()}
        >
          Create
        </Button>
      }
    >
      {create.error ? <ErrorBox error={create.error} /> : null}
      <div className="space-y-3">
        <label className="block">
          <span className="text-xs text-subtle">Name</span>
          <Input value={name} onChange={(event) => setName(event.target.value)} aria-label="Name" />
        </label>
        <label className="block">
          <span className="text-xs text-subtle">Slug</span>
          <Input
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            placeholder={name.trim() === '' ? 'meu-produto' : slugify(name)}
            aria-label="Slug"
          />
          <span className="mt-0.5 block text-[11px] text-subtle">
            Also what a project’s <span className="font-mono">dev-gateway.project</span> label must say to
            be adopted automatically.
          </span>
        </label>
        <label className="block">
          <span className="text-xs text-subtle">Description</span>
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            aria-label="Description"
          />
        </label>
      </div>
    </Dialog>
  )
}
