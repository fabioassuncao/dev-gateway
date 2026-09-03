import type { Commit } from '../../../shared/types.ts'
import { useFormat } from '../../lib/use-format.ts'
import { cn } from '../../lib/utils.ts'

/** One commit, as a line: sha, subject, author and when. The sha is a link when the forge is known. */
export function CommitRow({ commit, className }: { commit: Commit; className?: string }) {
  const { relativeTime } = useFormat()
  const sha = commit.url ? (
    <a className="font-mono text-xs text-accent underline-offset-2 hover:underline" href={commit.url} target="_blank" rel="noreferrer noopener">
      {commit.shortSha}
    </a>
  ) : (
    <span className="font-mono text-xs text-muted">{commit.shortSha}</span>
  )
  return (
    <div className={cn('flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2 text-sm', className)} data-commit={commit.sha}>
      {sha}
      <span className="min-w-0 flex-1 truncate text-ink" title={commit.subject}>{commit.subject}</span>
      <span className="text-xs text-subtle">
        {commit.author}
        {commit.date ? ` · ${relativeTime(commit.date)}` : ''}
      </span>
    </div>
  )
}
