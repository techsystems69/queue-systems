'use client'

import { useMemo } from 'react'
import { actionableEntries, ALERT_PHRASE, isNotifiable } from '@/lib/counterNotifications'
import { removePushSubscriptionAction, savePushSubscriptionAction } from '@/lib/actions/push'
import { COUNTER_ALERT_TAG } from '@/lib/push/payload'
import { useAlerts } from '@/lib/hooks/useAlerts'
import type { CounterType, QueueEntryDTO } from '@/lib/db/types'

interface Options {
  counterType: CounterType
  counterToken: string
  counterName: string
  entries: QueueEntryDTO[]
  isLoading: boolean
}

// Alerts for hotel/restaurant counters (Kitchen, Billing, Delivery): an order
// that has just become work for this station. Order and Call counters
// originate work, so for them `items` is always empty.
export function useCounterNotifications({ counterType, counterToken, counterName, entries, isLoading }: Options) {
  const items = useMemo(
    () => (isLoading || !isNotifiable(counterType)
      ? null
      : actionableEntries(counterType, entries).map(e => ({ id: e.id, label: `#${e.queueNumber}` }))),
    [isLoading, counterType, entries]
  )

  return useAlerts({
    storageKey: `queueflow:alerts:${counterToken}`,
    tag: COUNTER_ALERT_TAG,
    save: (sub, ua) => savePushSubscriptionAction(counterToken, sub, ua),
    remove: endpoint => removePushSubscriptionAction(counterToken, endpoint),
    items,
    heading: counterName,
    noun: 'order',
    phrase: ALERT_PHRASE[counterType] ?? 'waiting',
  })
}
