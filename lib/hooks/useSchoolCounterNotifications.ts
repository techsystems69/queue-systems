'use client'

import { useMemo } from 'react'
import { removeSchoolCounterPushAction, saveSchoolCounterPushAction } from '@/lib/actions/push'
import { COUNTER_ALERT_TAG } from '@/lib/push/payload'
import { useAlerts } from '@/lib/hooks/useAlerts'
import type { SchoolTokenDTO } from '@/lib/db/school-types'

interface Options {
  counterToken: string
  counterName: string
  // The console's waiting lane: tokens this window may call, held ones included.
  waiting: SchoolTokenDTO[]
}

// Alerts for a school calling station: a visitor's token has started waiting
// for one of this window's departments. Held tokens are parked on purpose, so
// they never count as news (a token returning from hold re-enters as waiting).
export function useSchoolCounterNotifications({ counterToken, counterName, waiting }: Options) {
  const items = useMemo(
    () => waiting.filter(t => t.status === 'waiting').map(t => ({ id: t.id, label: t.tokenCode })),
    [waiting]
  )

  return useAlerts({
    storageKey: `queueflow:alerts:${counterToken}`,
    tag: COUNTER_ALERT_TAG,
    save: (sub, ua) => saveSchoolCounterPushAction(counterToken, sub, ua),
    remove: endpoint => removeSchoolCounterPushAction(counterToken, endpoint),
    items,
    heading: counterName,
    noun: 'token',
    phrase: 'waiting',
  })
}
