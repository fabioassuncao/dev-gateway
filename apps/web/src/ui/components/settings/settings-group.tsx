import type { ConfigField as ConfigFieldView } from '../../../shared/types.ts'
import { useTranslation } from 'react-i18next'
import { Card, CardBody, CardHeader } from '../ui/card.tsx'
import { ConfigField } from './config-field.tsx'

export function SettingsGroup({
  name,
  fields,
  valueOf,
  onChange,
}: {
  name: string
  fields: ConfigFieldView[]
  valueOf: (field: ConfigFieldView) => string
  onChange: (key: string, value: string | null) => void
}) {
  const { t } = useTranslation('settings')

  return (
    <Card className="min-w-0 flex-1">
      <CardHeader title={t(`groups.${name}`, { defaultValue: name })} />
      <CardBody className="space-y-4">
        {fields.map((field) => (
          <ConfigField
            key={field.key}
            field={field}
            value={valueOf(field)}
            onChange={(value) => onChange(field.key, value)}
          />
        ))}
      </CardBody>
    </Card>
  )
}
