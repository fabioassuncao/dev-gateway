import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/utils.ts'

const button = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors select-none disabled:pointer-events-none disabled:opacity-45 whitespace-nowrap',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-fg shadow-raised hover:brightness-110 active:brightness-95',
        default: 'border border-line-strong bg-surface text-ink hover:bg-surface-2 active:bg-surface-3',
        /** For an action that is available but should not compete for the eye. */
        subtle: 'bg-surface-2 text-ink hover:bg-surface-3',
        ghost: 'text-muted hover:bg-surface-2 hover:text-ink',
        danger: 'border border-danger/40 text-danger hover:bg-danger/10 active:bg-danger/15',
        link: 'text-accent underline-offset-2 hover:underline',
      },
      size: {
        sm: 'h-7 px-2 text-xs',
        md: 'h-8 px-3 text-sm',
        icon: 'h-7 w-7',
        'icon-sm': 'h-6 w-6',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  children?: ReactNode
  /**
   * The work this button started is still running. It stays disabled and says
   * so, rather than looking clickable while nothing appears to happen.
   */
  busy?: boolean
}

export function Button({ className, variant, size, busy = false, disabled, children, ...props }: ButtonProps) {
  return (
    <button
      className={cn(button({ variant, size }), className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...props}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  )
}
