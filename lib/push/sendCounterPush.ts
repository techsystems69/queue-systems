import 'server-only'
import { createSupabaseServiceClient } from '@/lib/db/server'
import { ALERT_PHRASE, notifiedCounterTypes } from '@/lib/counterNotifications'
import { COUNTER_ALERT_TAG, MANAGER_ALERT_TAG } from '@/lib/push/payload'
import { deliverPush, ensureVapid, managerSubscriptionsForBranch, type PushRecipient } from '@/lib/push/deliver'
import type { CounterType, KitchenStatus, QueueStatus } from '@/lib/db/types'

// Matches the in-page SETTLE_MS: counters that register-and-call their own
// entry (Delivery/Call) flip it out of "waiting" within a moment, and that
// isn't work for anyone.
const SETTLE_MS = 1_500

interface EntryRow {
  id: string
  customer_id: string
  branch_id: string
  queue_number: number
  status: QueueStatus
  kitchen_status: KitchenStatus
}

interface CounterRow {
  id: string
  name: string
  type: CounterType
  counter_token: string
  accepting_orders: boolean
}

interface SubscriptionRow {
  id: string
  counter_id: string
  endpoint: string
  p256dh: string
  auth: string
}

// Called (after the response) by /api/push/notify for one hotel/restaurant
// queue entry. Pages the matching counters, and the branch's managers.
// Returns how many pushes were delivered, for logging/tests.
export async function notifyCountersForEntry(entryId: string): Promise<number> {
  if (!ensureVapid()) {
    console.warn('[push] skipped: VAPID env vars are not set on this deployment')
    return 0
  }

  await new Promise(resolve => setTimeout(resolve, SETTLE_MS))

  const supabase = createSupabaseServiceClient()
  const { data: entry } = await supabase
    .from('queue_entries')
    .select('id, customer_id, branch_id, queue_number, status, kitchen_status')
    .eq('id', entryId)
    .single<EntryRow>()
  if (!entry) {
    console.info('[push] skipped: entry not found', entryId)
    return 0
  }

  // Re-validate against the live row, not the webhook payload.
  const types = notifiedCounterTypes({ status: entry.status, kitchenStatus: entry.kitchen_status })
  if (types.length === 0) {
    console.info(`[push] skipped: entry #${entry.queue_number} no longer actionable (${entry.status}/${entry.kitchen_status})`)
    return 0
  }

  const label = `#${entry.queue_number}`

  // ── counters ──
  const { data: counters } = await supabase
    .from('counters')
    .select('id, name, type, counter_token, accepting_orders')
    .eq('branch_id', entry.branch_id)
    .eq('is_active', true)
    .in('type', types)
    .returns<CounterRow[]>()

  // A kitchen that is off-shift doesn't receive new orders (they skip prep).
  const targets = (counters ?? []).filter(c => c.type !== 'kitchen' || c.accepting_orders)
  const counterById = new Map(targets.map(c => [c.id, c]))

  const counterRecipients: PushRecipient[] = []
  if (targets.length) {
    const { data: subs } = await supabase
      .from('counter_push_subscriptions')
      .select('id, counter_id, endpoint, p256dh, auth')
      .in('counter_id', targets.map(c => c.id))
      .returns<SubscriptionRow[]>()
    for (const sub of subs ?? []) {
      const counter = counterById.get(sub.counter_id)
      if (!counter) continue
      counterRecipients.push({
        ...sub,
        payload: {
          heading: counter.name,
          label,
          noun: 'order',
          what: ALERT_PHRASE[counter.type] ?? 'waiting',
          url: `/counter/${counter.counter_token}`,
          tag: COUNTER_ALERT_TAG,
        },
      })
    }
  }

  // ── managers ──
  const managerRecipients: PushRecipient[] = []
  const managerSubs = await managerSubscriptionsForBranch(entry.customer_id, entry.branch_id)
  if (managerSubs.length) {
    const { data: branch } = await supabase.from('branches').select('name').eq('id', entry.branch_id).single<{ name: string }>()
    const what = entry.kitchen_status === 'pending' ? 'waiting to be prepared' : 'ready'
    for (const sub of managerSubs) {
      managerRecipients.push({
        ...sub,
        payload: { heading: branch?.name ?? 'Orders', label, noun: 'order', what, url: '/dashboard', tag: MANAGER_ALERT_TAG },
      })
    }
  }

  if (!counterRecipients.length && !managerRecipients.length) {
    console.info(
      `[push] skipped: nobody subscribed for entry ${label} — ${targets.length} matching counter(s), ` +
      `0 with a push subscription, 0 managers (tap the Alerts switch on the counter / bell in the top bar)`
    )
    return 0
  }

  const [sentCounters, sentManagers] = await Promise.all([
    deliverPush('counter_push_subscriptions', counterRecipients),
    deliverPush('manager_push_subscriptions', managerRecipients),
  ])
  console.info(`[push] entry ${label}: ${sentCounters} counter device(s), ${sentManagers} manager device(s)`)
  return sentCounters + sentManagers
}
