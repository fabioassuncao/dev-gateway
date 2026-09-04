'use client'

// What happened in this Project, newest first, with paging.

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ActivityEvent } from 'portta-contracts'
import { useProjectActivity } from '@/lib/queries'
import { Card, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/field'
import { ActivityTimeline } from '@/components/entities/activity-timeline'
import { ErrorBox, Loading } from '@/components/shell-bits'

export function ActivityTab({ slug, initialEvents }: { slug: string; initialEvents: ActivityEvent[] }) {
  const { t } = useTranslation('activity')
  const [kind, setKind] = useState('')
  const [actor, setActor] = useState('')
  const [before, setBefore] = useState<string | null>(null)
  const [pages, setPages] = useState<string[]>([])
  const filters = { kind: kind || undefined, actor: actor || undefined, limit: '50', before: before ?? undefined }
  const activity = useProjectActivity(slug, filters)
  // The server read the first page for this render; the query owns it after.
  const events = activity.data?.events ?? initialEvents

  const reset = () => {
    setBefore(null)
    setPages([])
  }

  return (
    <Card>
      <CardHeader
        title={t('title')}
        description={t('description')}
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <Select value={kind} onChange={(event) => { setKind(event.target.value); reset() }} size="sm" className="w-40" aria-label={t('kindFilter')}>
              <option value="">{t('anyKind')}</option>
              {['task', 'session', 'repository', 'environment', 'service', 'project'].map((entity) => (
                <option key={entity} value={entity}>{t(`entity.${entity}` as 'entity.task')}</option>
              ))}
            </Select>
            <Input value={actor} onChange={(event) => { setActor(event.target.value); reset() }} placeholder={t('actorFilter')} size="sm" className="w-36" aria-label={t('actorFilter')} />
          </div>
        }
      />
      {activity.isPending && events.length === 0 ? (
        <Loading />
      ) : activity.error ? (
        <ErrorBox error={activity.error} />
      ) : (
        <>
          {pages.length > 0 ? (
            <div className="px-3 pt-2">
              <Button size="sm" onClick={() => { const previous = [...pages]; const last = previous.pop() ?? null; setPages(previous); setBefore(last) }}>{t('newer')}</Button>
            </div>
          ) : null}
          <ActivityTimeline
            events={events}
            showProject={false}
            onLoadMore={activity.data?.nextBefore ? () => { setPages([...pages, before ?? '']); setBefore(activity.data!.nextBefore) } : null}
          />
        </>
      )}
    </Card>
  )
}
