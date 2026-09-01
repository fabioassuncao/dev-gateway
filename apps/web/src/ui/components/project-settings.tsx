import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../lib/api.ts'
import type { Project } from '../../shared/types.ts'
import { Dialog } from './ui/dialog.tsx'
import { Button } from './ui/button.tsx'
import { Input, Select } from './ui/field.tsx'
import { ErrorBox } from './shell-bits.tsx'
import { Switch } from './ui/switch.tsx'

/**
 * What the gateway decided about this project.
 *
 * Everything here is presentation, stored in the gateway's own database. Not a
 * byte is written inside the project: no file, no label, no dependency, no
 * commit. The derived name is shown beside the override rather than replaced,
 * so nobody ever debugs a project the panel quietly renamed.
 */
export function ProjectSettingsDialog({
  project,
  open,
  onOpenChange,
}: {
  project: Project
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['project-settings', project.name],
    queryFn: () => api.projectSettings(project.name),
    enabled: open,
    retry: false,
  })

  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [primaryService, setPrimaryService] = useState('')
  const [hidden, setHidden] = useState<string[]>([])
  const [pinned, setPinned] = useState(false)
  const [archived, setArchived] = useState(false)

  useEffect(() => {
    if (!query.data) return
    setDisplayName(query.data.displayName ?? '')
    setDescription(query.data.description ?? '')
    setPrimaryService(query.data.primaryService ?? '')
    setHidden(query.data.hiddenServices ?? [])
    setPinned(query.data.pinned ?? false)
    setArchived(query.data.archived ?? false)
  }, [query.data])

  const save = useMutation({
    mutationFn: () =>
      api.setProjectSettings(project.name, {
        displayName: displayName.trim() === '' ? null : displayName.trim(),
        description: description.trim() === '' ? null : description.trim(),
        primaryService: primaryService === '' ? null : primaryService,
        hiddenServices: hidden.length === 0 ? null : hidden,
        pinned: pinned ? true : null,
        archived: archived ? true : null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries()
      onOpenChange(false)
    },
  })

  const reset = useMutation({
    mutationFn: () => api.clearProjectSettings(project.name),
    onSuccess: () => {
      void queryClient.invalidateQueries()
      onOpenChange(false)
    },
  })

  const names = project.services.map((service) => service.service ?? service.name)
  const unavailable = query.error instanceof ApiError && query.error.status === 503

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Settings for ${project.name}`}
      description="Kept in the gateway's own database. Nothing is written inside the project."
      footer={
        <>
          <Button size="sm" disabled={reset.isPending || unavailable} onClick={() => reset.mutate()}>
            Reset
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={save.isPending || unavailable}
            onClick={() => save.mutate()}
          >
            Save
          </Button>
        </>
      }
    >
      {query.error ? <ErrorBox error={query.error} /> : null}

      <div className="space-y-3">
        <label className="block">
          <span className="text-xs text-subtle">Display name</span>
          <Input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder={project.name}
            aria-label="Display name"
          />
          <span className="mt-0.5 block text-[11px] text-subtle">
            Derived name stays {project.name}, and is always shown beside this.
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

        <label className="block">
          <span className="text-xs text-subtle">Primary service</span>
          <Select
            value={primaryService}
            onChange={(event) => setPrimaryService(event.target.value)}
            aria-label="Primary service"
          >
            <option value="">None</option>
            {names.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </label>

        <fieldset className="space-y-1">
          <legend className="text-xs text-subtle">Collapsed services</legend>
          <p className="text-[11px] text-subtle">Collapsed by default, never removed.</p>
          {names.map((name) => (
            <label key={name} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hidden.includes(name)}
                onChange={(event) =>
                  setHidden((current) =>
                    event.target.checked
                      ? [...current, name]
                      : current.filter((entry) => entry !== name),
                  )
                }
              />
              {name}
            </label>
          ))}
        </fieldset>

        <div className="flex items-center justify-between gap-3">
          <span className="text-sm">Pinned</span>
          <Switch checked={pinned} onCheckedChange={setPinned} aria-label="Pinned" />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm">Archived</span>
          <Switch checked={archived} onCheckedChange={setArchived} aria-label="Archived" />
        </div>
      </div>
    </Dialog>
  )
}
