import type { InputHTMLAttributes, SelectHTMLAttributes } from 'react'
import { cn } from '../../lib/utils.ts'

const base =
  'h-8 w-full rounded-md border border-line-strong bg-surface px-2 text-sm text-ink placeholder:text-subtle disabled:opacity-50'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(base, className)} {...props} />
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(base, 'pr-6', className)} {...props} />
}
