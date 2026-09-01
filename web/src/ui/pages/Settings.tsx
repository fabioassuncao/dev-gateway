import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Save, ShieldCheck } from 'lucide-react'
import { api } from '../lib/api.ts'
import type { ConfigField } from '../../shared/types.ts'
import { Card, CardBody, CardHeader } from '../components/ui/card.tsx'
import { Badge } from '../components/ui/badge.tsx'
import { Button } from '../components/ui/button.tsx'
import { Input, Select } from '../components/ui/field.tsx'
import { Switch } from '../components/ui/switch.tsx'
import { ErrorBox, Loading, PageHeader } from '../components/shell-bits.tsx'
import { CopyButton } from '../components/copy.tsx'

export function Settings() {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Record<string, string | null>>({})
  const [error, setError] = useState<unknown>(null)
  const [saved, setSaved] = useState(false)

  const query = useQuery({ queryKey: ['config'], queryFn: api.config })

  const save = useMutation({
    mutationFn: () => api.patchConfig(draft),
    onSuccess: () => {
      setDraft({})
      setError(null)
      setSaved(true)
      void queryClient.invalidateQueries({ queryKey: ['config'] })
    },
    onError: (cause) => {
      setSaved(false)
      setError(cause)
    },
  })

  const groups = useMemo(() => {
    const byGroup = new Map<string, ConfigField[]>()
    for (const field of query.data?.fields ?? []) {
      const list = byGroup.get(field.group)
      if (list) list.push(field)
      else byGroup.set(field.group, [field])
    }
    return [...byGroup.entries()]
  }, [query.data])

  if (query.isPending) return <Loading />
  if (query.error) return <ErrorBox error={query.error} />
  if (!query.data) return null

  const dirty = Object.keys(draft).length > 0
  const view = query.data

  const valueOf = (field: ConfigField): string => {
    const pending = draft[field.key]
    if (pending !== undefined) return pending ?? ''
    return field.value ?? ''
  }

  const setValue = (key: string, value: string | null) =>
    setDraft((current) => ({ ...current, [key]: value }))

  return (
    <>
      <PageHeader
        title="Settings"
        description="The gateway’s .env, edited through a fixed list of keys."
        actions={
          <>
            {dirty ? <Badge tone="warn">{Object.keys(draft).length} unsaved</Badge> : null}
            <Button
              variant="primary"
              disabled={!dirty || save.isPending || !view.envFile.writable}
              onClick={() => save.mutate()}
            >
              <Save className="h-3.5 w-3.5" />
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      />

      {!view.envFile.writable ? (
        <div className="mb-4 rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-sm text-warn">
          The panel cannot write <span className="font-mono text-xs">{view.envFile.path}</span>. Edit it
          on the host instead.
        </div>
      ) : null}

      {error ? (
        <div className="mb-4">
          <ErrorBox error={error} />
        </div>
      ) : null}

      {(view.pendingRestart || saved) && !dirty ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-info/40 bg-info/5 px-3 py-2 text-sm text-info">
          <ShieldCheck className="h-4 w-4" />
          <span>
            Saved. Traefik reads its static configuration at startup, so these values take effect once the
            gateway containers are recreated on the host:
          </span>
          <span className="font-mono text-xs">{view.applyCommand}</span>
          <CopyButton value={view.applyCommand} label="Copy command" />
        </div>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        {groups.map(([group, fields]) => (
          <Card key={group}>
            <CardHeader title={group} />
            <CardBody className="space-y-4">
              {fields.map((field) => (
                <div key={field.key} className="grid gap-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <label htmlFor={field.key} className="text-sm font-medium text-ink">
                      {field.label}
                      {field.pending ? (
                        <Badge tone="warn" className="ml-2">
                          pending restart
                        </Badge>
                      ) : null}
                    </label>
                    {field.kind === 'boolean' ? (
                      <Switch
                        id={field.key}
                        checked={valueOf(field) === 'true'}
                        onCheckedChange={(checked) => setValue(field.key, checked ? 'true' : 'false')}
                      />
                    ) : null}
                  </div>

                  {field.kind === 'choice' ? (
                    <Select
                      id={field.key}
                      value={valueOf(field)}
                      onChange={(event) => setValue(field.key, event.target.value)}
                    >
                      {(field.choices ?? []).map((choice) => (
                        <option key={choice} value={choice}>
                          {choice}
                        </option>
                      ))}
                    </Select>
                  ) : null}

                  {field.kind === 'string' || field.kind === 'number' ? (
                    field.secret ? (
                      <div className="flex items-center gap-2">
                        <Input
                          id={field.key}
                          type="password"
                          autoComplete="off"
                          placeholder={field.isSet ? '•••••••• (unchanged)' : 'not set'}
                          value={draft[field.key] ?? ''}
                          onChange={(event) => setValue(field.key, event.target.value)}
                        />
                        <Badge tone={field.isSet ? 'ok' : 'neutral'}>
                          {field.isSet ? 'set' : 'unset'}
                        </Badge>
                        {field.isSet ? (
                          <Button size="sm" variant="ghost" onClick={() => setValue(field.key, null)}>
                            Clear
                          </Button>
                        ) : null}
                      </div>
                    ) : (
                      <Input
                        id={field.key}
                        inputMode={field.kind === 'number' ? 'numeric' : undefined}
                        value={valueOf(field)}
                        onChange={(event) => setValue(field.key, event.target.value)}
                      />
                    )
                  ) : null}

                  <p className="text-xs text-muted">{field.help}</p>
                  <p className="font-mono text-[10px] text-subtle">{field.key}</p>
                </div>
              ))}
            </CardBody>
          </Card>
        ))}
      </div>

      <p className="mt-4 text-xs text-subtle">
        Secrets are never returned by the API: the panel only reports whether a token is set. Values are
        written to <span className="font-mono">{view.envFile.path}</span> with mode 600.
      </p>
    </>
  )
}
