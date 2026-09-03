import { useTranslation } from 'react-i18next'
import type { ForgePullRequest } from '../../../shared/types.ts'
import { Badge } from '../ui/badge.tsx'

/** One open pull request with its review decision and checks, as a line. */
export function PullRequestRow({ pull, showBranch = false }: { pull: ForgePullRequest; showBranch?: boolean }) {
  const { t } = useTranslation('repositories', { keyPrefix: 'pulls' })
  const review =
    pull.reviewDecision === 'APPROVED'
      ? { tone: 'ok' as const, label: t('approved') }
      : pull.reviewDecision === 'CHANGES_REQUESTED'
        ? { tone: 'danger' as const, label: t('changesRequested') }
        : pull.reviewDecision === 'REVIEW_REQUIRED'
          ? { tone: 'warn' as const, label: t('reviewRequested') }
          : null
  const title = `#${pull.number} ${pull.title}`
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 text-xs">
      {pull.url ? (
        <a className="underline-offset-2 hover:text-accent hover:underline" href={pull.url} target="_blank" rel="noreferrer noopener">
          {title}
        </a>
      ) : (
        <span>{title}</span>
      )}
      {pull.draft ? <Badge>{t('draft')}</Badge> : null}
      {review ? <Badge tone={review.tone}>{review.label}</Badge> : null}
      {pull.checks === 'failing' ? (
        <Badge tone="danger">{t('checksFailing')}</Badge>
      ) : pull.checks === 'pending' ? (
        <Badge tone="warn">{t('checksPending')}</Badge>
      ) : pull.checks === 'passing' ? (
        <Badge tone="ok">{t('checksPassing')}</Badge>
      ) : null}
      {showBranch && pull.headRefName ? <span className="font-mono text-[11px] text-subtle">{pull.headRefName}</span> : null}
    </div>
  )
}
