import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/utils.ts'

const button = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors select-none disabled:pointer-events-none disabled:opacity-45 whitespace-nowrap',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-fg hover:opacity-90',
        default: 'border border-line-strong bg-surface text-ink hover:bg-surface-2',
        ghost: 'text-muted hover:bg-surface-2 hover:text-ink',
        danger: 'border border-danger/40 text-danger hover:bg-danger/10',
        link: 'text-accent underline-offset-2 hover:underline',
      },
      size: {
        sm: 'h-7 px-2 text-xs',
        md: 'h-8 px-3 text-sm',
        icon: 'h-7 w-7',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  children?: ReactNode
}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(button({ variant, size }), className)} {...props} />
}
