import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api, ApiError } from '../lib/api.ts'
import type { Environment } from '../../shared/types.ts'
import { Dialog } from './ui/dialog.tsx'
import { Button } from './ui/button.tsx'
import { Input, Select } from './ui/field.tsx'
import { ErrorBox } from './shell-bits.tsx'
import { Switch } from './ui/switch.tsx'

export function ProjectSettingsDialog({
  project,
  open,
  onOpenChange,
}: {
  project: Environment
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('gateway', { keyPrefix: 'settings.overrides' })
  const { t: tc } = useTranslation('common')
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
      title={t('title', { defaultValue: 'Settings for {{name}}', name: project.name })}
      description={t('description')}
      footer={
        <>
          <Button size="sm" disabled={reset.isPending || unavailable} onClick={() => reset.mutate()}>
            {t('reset', { defaultValue: 'Reset' })}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={save.isPending || unavailable}
            onClick={() => save.mutate()}
          >
            {tc('save')}
          </Button>
        </>
      }
    >
      {query.error ? <ErrorBox error={query.error} /> : null}

      <div className="space-y-3">
        <label className="block">
          <span className="text-xs text-subtle">{t('displayName')}</span>
          <Input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder={project.name}
            aria-label={t('displayName')}
          />
          <span className="mt-0.5 block text-[11px] text-subtle">
            {t('derivedNameHint', {
              defaultValue: 'Derived name stays {{name}}, and is always shown beside this.',
              name: project.name,
            })}
          </span>
        </label>

        <label className="block">
          <span className="text-xs text-subtle">{t('descriptionLabel')}</span>
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            aria-label={t('descriptionLabel')}
          />
        </label>

        <label className="block">
          <span className="text-xs text-subtle">{t('primaryService')}</span>
          <Select
            value={primaryService}
            onChange={(event) => setPrimaryService(event.target.value)}
            aria-label={t('primaryService')}
          >
            <option value="">{t('none', { defaultValue: 'None' })}</option>
            {names.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </label>

        <fieldset className="space-y-1">
          <legend className="text-xs text-subtle">{t('collapsedServices', { defaultValue: 'Collapsed services' })}</legend>
          <p className="text-[11px] text-subtle">
            {t('collapsedServicesHint', { defaultValue: 'Collapsed by default, never removed.' })}
          </p>
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
          <span className="text-sm">{t('pinned')}</span>
          <Switch checked={pinned} onCheckedChange={setPinned} aria-label={t('pinned')} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm">{t('archived')}</span>
          <Switch checked={archived} onCheckedChange={setArchived} aria-label={t('archived')} />
        </div>
      </div>
    </Dialog>
  )
}
