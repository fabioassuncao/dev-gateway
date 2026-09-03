import type { ConfigField as ConfigFieldView } from '../../../shared/types.ts'
import { useTranslation } from 'react-i18next'
import { RotateCw } from 'lucide-react'
import { DocText } from '../doc-text.tsx'
import { Badge } from '../ui/badge.tsx'
import { Button } from '../ui/button.tsx'
import { Input, Select } from '../ui/field.tsx'
import { Switch } from '../ui/switch.tsx'
import { Tooltip } from '../ui/tooltip.tsx'

/**
 * One setting, and everything a person needs before changing it: what it is,
 * what it does, what it is set to right now, whether the running process has
 * caught up, and whether it will until something restarts.
 *
 * `restartRequired` was already on the wire and shown nowhere, so the answer to
 * "I flipped it, why is nothing different?" was a support question rather than
 * a label. It is a label now.
 */
export function ConfigField({
  field,
  value,
  onChange,
}: {
  field: ConfigFieldView
  value: string
  onChange: (value: string | null) => void
}) {
  const { t } = useTranslation('settings')
  const { t: tc } = useTranslation('common')

  const boolean = field.kind === 'boolean'
  const on = value === 'true'
  // A secret's value never leaves the server, so "what it is now" is only ever
  // "set" or "not set" for one.
  const current = field.secret
    ? (field.isSet ? tc('set') : tc('notSet'))
    : boolean
      ? (on ? tc('enabled') : tc('disabled'))
      : (field.runtimeValue ?? tc('notSet'))

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={field.key} className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
          {t(`fields.${field.key}.label`, { defaultValue: field.label })}
          {field.pending ? (
            <Tooltip label={t('pendingHint', { value: field.runtimeValue ?? tc('notSet') })}>
              <span tabIndex={0} className="rounded outline-none focus-visible:outline-2 focus-visible:outline-accent">
                <Badge tone="warn" dot>{tc('pendingRestart')}</Badge>
              </span>
            </Tooltip>
          ) : field.restartRequired ? (
            <Tooltip label={t('restartHint')}>
              <span tabIndex={0} className="inline-flex rounded text-subtle outline-none focus-visible:outline-2 focus-visible:outline-accent">
                <RotateCw className="h-3 w-3" aria-label={t('restartRequired')} />
              </span>
            </Tooltip>
          ) : null}
        </label>
        {boolean ? (
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs text-muted">{current}</span>
            <Switch
              id={field.key}
              checked={on}
              onCheckedChange={(checked) => onChange(checked ? 'true' : 'false')}
            />
          </div>
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
              placeholder={field.isSet ? tc('unchanged') : tc('notSet')}
              value={value}
              onChange={(event) => onChange(event.target.value)}
            />
            <Badge tone={field.isSet ? 'ok' : 'neutral'}>{field.isSet ? tc('set') : tc('unset')}</Badge>
            {field.isSet ? (
              <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
                {tc('clear')}
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

      <p className="text-xs text-muted">
        <DocText>{t(`fields.${field.key}.help`, { defaultValue: field.help })}</DocText>
      </p>
      <p className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-subtle">
        <span>{field.key}</span>
        {!boolean && !field.secret && field.runtimeValue ? (
          <span className="not-italic">{t('runningValue', { value: field.runtimeValue })}</span>
        ) : null}
      </p>
    </div>
  )
}
