import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api.ts'
import type { ContainerSummary } from '../../shared/types.ts'
import { Badge } from './ui/badge.tsx'
import { Button } from './ui/button.tsx'
import { Input } from './ui/field.tsx'
import { ErrorBox } from './shell-bits.tsx'

/**
 * A nickname, never a rename.
 *
 * Docker cannot rewrite a label on a running container, so an alias can only
 * add a router beside the project's own: both hostnames answer, and both are
 * on screen. A hostname the gateway cannot serve, or one another container
 * already claims, is refused here with the reason rather than written and
 * silently dropped by Traefik.
 */
export function ServiceAlias({
  project,
  service,
}: {
  project: string
  service: ContainerSummary
}) {
  const name = service.service ?? service.name
  const queryClient = useQueryClient()
  const [value, setValue] = useState(service.overrides?.alias ?? '')

  const current = service.overrides?.alias ?? null

  const save = useMutation({
    mutationFn: () => api.serviceAlias(project, name, value.trim()),
    onSuccess: () => void queryClient.invalidateQueries(),
  })

  const clear = useMutation({
    mutationFn: () => api.clearServiceAlias(project, name),
    onSuccess: () => {
      setValue('')
      void queryClient.invalidateQueries()
    },
  })

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {service.urls.map((url) => (
          <Badge key={url.host} tone="outline">
            {url.host}
          </Badge>
        ))}
        {current ? <Badge tone="accent">alias: {current}</Badge> : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="shop.localhost"
          className="h-7 w-56"
          aria-label={`Hostname alias for ${name}`}
        />
        <Button
          size="sm"
          disabled={save.isPending || value.trim() === ''}
          onClick={() => save.mutate()}
        >
          {current ? 'Update alias' : 'Add alias'}
        </Button>
        {current ? (
          <Button size="sm" disabled={clear.isPending} onClick={() => clear.mutate()}>
            Remove
          </Button>
        ) : null}
      </div>

      {save.error ? <ErrorBox error={save.error} /> : null}
      {clear.error ? <ErrorBox error={clear.error} /> : null}

      <p className="text-[11px] text-subtle">
        An alias is additional: the project keeps answering on the hostname it derives.
      </p>
    </div>
  )
}
