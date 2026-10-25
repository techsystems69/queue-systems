import type { CounterType, QueueEntryDTO } from '@/lib/db/types'

// What counts as a "valid" notification for a counter: an order that has just
// become work for *that* station. Kitchen is paged by fresh orders waiting to
// be prepped; Billing and Delivery by orders the kitchen has marked ready.
// Order and Call counters originate work rather than receive it, so they are
// never paged. Shared by the in-page alerts and the server-side push sender so
// both always agree on who needs to know.
export function notifiedCounterTypes(e: Pick<QueueEntryDTO, 'status' | 'kitchenStatus'>): CounterType[] {
  if (e.status !== 'waiting') return []
  if (e.kitchenStatus === 'pending') return ['kitchen']
  if (e.kitchenStatus === 'ready') return ['billing', 'delivery']
  return []
}

export function actionableEntries(type: CounterType, entries: QueueEntryDTO[]): QueueEntryDTO[] {
  return entries.filter(e => notifiedCounterTypes(e).includes(type))
}

export function isNotifiable(type: CounterType): boolean {
  return type === 'kitchen' || type === 'billing' || type === 'delivery'
}

export const ALERT_PHRASE: Partial<Record<CounterType, string>> = {
  kitchen: 'waiting to be prepared',
  billing: 'ready for billing',
  delivery: 'ready for delivery',
}

export function describeAlert(type: CounterType, entries: Pick<QueueEntryDTO, 'queueNumber'>[]): { title: string; body: string } {
  const sorted = [...entries].sort((a, b) => a.queueNumber - b.queueNumber)
  const what = ALERT_PHRASE[type] ?? 'waiting'
  if (sorted.length === 1) {
    return { title: `Order #${sorted[0].queueNumber}`, body: `Order #${sorted[0].queueNumber} is ${what}` }
  }
  const numbers = sorted.slice(0, 4).map(e => `#${e.queueNumber}`).join(', ')
  return {
    title: `${sorted.length} orders ${what}`,
    body: sorted.length > 4 ? `${numbers} and ${sorted.length - 4} more` : numbers,
  }
}
