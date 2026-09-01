import type { ConfigField as ConfigFieldView } from '../../../shared/types.ts'
import { Badge } from '../ui/badge.tsx'
import { Button } from '../ui/button.tsx'
import { Input, Select } from '../ui/field.tsx'
import { Switch } from '../ui/switch.tsx'

export function ConfigField({
  field,
  value,
  onChange,
}: {
  field: ConfigFieldView
  value: string
  onChange: (value: string | null) => void
}) {
  return (
    <div className="grid gap-1.5">
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
            checked={value === 'true'}
            onCheckedChange={(checked) => onChange(checked ? 'true' : 'false')}
          />
        ) : null}
      </div>

      {field.kind === 'choice' ? (
        <Select id={field.key} value={value} onChange={(event) => onChange(event.target.value)}>
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
              value={value}
              onChange={(event) => onChange(event.target.value)}
            />
            <Badge tone={field.isSet ? 'ok' : 'neutral'}>{field.isSet ? 'set' : 'unset'}</Badge>
            {field.isSet ? (
              <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
                Clear
              </Button>
            ) : null}
          </div>
        ) : (
          <Input
            id={field.key}
            inputMode={field.kind === 'number' ? 'numeric' : undefined}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        )
      ) : null}

      <p className="text-xs text-muted">{field.help}</p>
      <p className="font-mono text-[10px] text-subtle">{field.key}</p>
    </div>
  )
}
