import type { ConfigField as ConfigFieldView } from '../../../shared/types.ts'
import { useTranslation } from 'react-i18next'
import { RotateCw } from 'lucide-react'
import { DocText } from '../doc-text.tsx'
import { Badge } from '../ui/badge.tsx'
import { Button } from '../ui/button.tsx'
import { Field, Input, Select } from '../ui/field.tsx'
import { Switch } from '../ui/switch.tsx'
import { Tooltip } from '../ui/tooltip.tsx'
import { CodeChip } from '../copy.tsx'

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

  const label = (
    <span className="inline-flex flex-wrap items-center gap-2">
      {t(`fields.${field.key}.label`, { defaultValue: field.label })}
      {field.pending ? (
        <Tooltip label={t('pendingHint', { value: field.runtimeValue ?? tc('notSet') })}>
          <span tabIndex={0} className="rounded-xs focus-ring">
            <Badge tone="warn" dot>{tc('pendingRestart')}</Badge>
          </span>
        </Tooltip>
      ) : null}
    </span>
  )

  const hint = (
    <>
      <DocText>{t(`fields.${field.key}.help`, { defaultValue: field.help })}</DocText>
      <span className="mt-1 flex flex-wrap items-center gap-2 text-2xs">
        <CodeChip tone="muted">{field.key}</CodeChip>
        {!boolean && !field.secret && field.runtimeValue ? (
          <span>{t('runningValue', { value: field.runtimeValue })}</span>
        ) : null}
        {field.restartRequired && !field.pending ? (
          // A fact about the setting, not an action: it sits with the other
          // facts under the control, where a refresh icon after the label
          // used to ask to be clicked.
          <Tooltip label={t('restartHint')}>
            <span tabIndex={0} className="inline-flex items-center gap-1 rounded-xs text-subtle focus-ring">
              <RotateCw className="size-3" aria-hidden />
              {t('restartRequired')}
            </span>
          </Tooltip>
        ) : null}
      </span>
    </>
  )

  if (boolean) {
    return (
      <Field id={field.key} label={label} hint={hint} inline>
        <span className="flex items-center gap-2">
          <span className="text-xs text-subtle">{current}</span>
          <Switch
            id={field.key}
            checked={on}
            onCheckedChange={(checked) => onChange(checked ? 'true' : 'false')}
          />
        </span>
      </Field>
    )
  }

  return (
    <Field id={field.key} label={label} hint={hint}>
      {field.kind === 'choice' ? (
        <Select id={field.key} size="sm" className="w-full max-w-md" value={value} onChange={(event) => onChange(event.target.value)}>
          {(field.choices ?? []).map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </Select>
      ) : field.secret ? (
        <span className="flex max-w-md items-center gap-2">
          <Input
            id={field.key}
            size="sm"
            type="password"
            autoComplete="off"
            mono
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
        </span>
      ) : (
        <Input
          id={field.key}
          size="sm"
          className="max-w-md"
          mono={field.kind === 'string'}
          inputMode={field.kind === 'number' ? 'numeric' : undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  )
}
