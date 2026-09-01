import * as Primitive from '@radix-ui/react-switch'
import { cn } from '../../lib/utils.ts'

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  id,
  'aria-label': label,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  id?: string
  'aria-label'?: string
}) {
  return (
    <Primitive.Root
      id={id}
      aria-label={label}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full border border-line-strong transition-colors',
        checked ? 'bg-accent' : 'bg-surface-2',
        disabled && 'opacity-50',
      )}
    >
      <Primitive.Thumb className="block h-3.5 w-3.5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-4" />
    </Primitive.Root>
  )
}
