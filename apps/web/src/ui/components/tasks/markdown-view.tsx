import MarkdownIt from 'markdown-it'
import { useMemo } from 'react'
import { cn } from '../../lib/utils.ts'

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false })

export function MarkdownView({ source, className }: { source: string; className?: string }) {
  const html = useMemo(() => markdown.render(source), [source])
  return (
    <div
      className={cn(
        'max-w-none text-sm leading-relaxed text-ink',
        '[&_a]:text-accent [&_a]:underline-offset-2 hover:[&_a]:underline',
        '[&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px]',
        '[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-line [&_pre]:bg-surface-2 [&_pre]:p-3',
        '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
        '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5',
        '[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-line-strong [&_blockquote]:pl-3 [&_blockquote]:text-muted',
        '[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold',
        '[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold',
        '[&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-medium',
        '[&_table]:my-3 [&_table]:w-full [&_table]:text-left [&_th]:border-b [&_th]:border-line [&_th]:py-1 [&_td]:border-b [&_td]:border-line/70 [&_td]:py-1',
        '[&_p]:my-2 [&_hr]:my-4 [&_hr]:border-line',
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
