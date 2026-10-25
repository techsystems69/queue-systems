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

// Wording shared by the in-page alert and the service worker (public/sw.js
// mirrors this for pushed notifications — keep them in step).
export function describeAlertItems(
  noun: string,
  phrase: string,
  labels: string[]
): { title: string; body: string } {
  const Noun = noun.charAt(0).toUpperCase() + noun.slice(1)
  if (labels.length === 1) {
    return { title: `${Noun} ${labels[0]}`, body: `${Noun} ${labels[0]} is ${phrase}` }
  }
  const shown = labels.slice(0, 4).join(', ')
  return {
    title: `${labels.length} ${noun}s ${phrase}`,
    body: labels.length > 4 ? `${shown} and ${labels.length - 4} more` : shown,
  }
}
