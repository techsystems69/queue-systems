import 'server-only'
import webpush from 'web-push'
import { createSupabaseServiceClient } from '@/lib/db/server'
import { ALERT_PHRASE, notifiedCounterTypes } from '@/lib/counterNotifications'
import type { CounterType, KitchenStatus, QueueStatus } from '@/lib/db/types'

// Matches the in-page SETTLE_MS: counters that register-and-call their own
// entry (Delivery/Call) flip it out of "waiting" within a moment, and that
// isn't work for anyone.
const SETTLE_MS = 1_500
// A page that never reaches the tablet in 10 minutes is no longer news.
const PUSH_TTL_SECONDS = 600

interface EntryRow {
  id: string
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

let vapidReady = false
function ensureVapid(): boolean {
  if (vapidReady) return true
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT
  if (!publicKey || !privateKey || !subject) return false
  webpush.setVapidDetails(subject, publicKey, privateKey)
  vapidReady = true
  return true
}

// Called (after the response) by /api/push/notify for one queue entry.
// Returns how many pushes were attempted, for logging/tests.
export async function notifyCountersForEntry(entryId: string): Promise<number> {
  if (!ensureVapid()) return 0

  await new Promise(resolve => setTimeout(resolve, SETTLE_MS))

  const supabase = createSupabaseServiceClient()
  const { data: entry } = await supabase
    .from('queue_entries')
    .select('id, branch_id, queue_number, status, kitchen_status')
    .eq('id', entryId)
    .single<EntryRow>()
  if (!entry) return 0

  // Re-validate against the live row, not the webhook payload.
  const types = notifiedCounterTypes({ status: entry.status, kitchenStatus: entry.kitchen_status })
  if (types.length === 0) return 0

  const { data: counters } = await supabase
    .from('counters')
    .select('id, name, type, counter_token, accepting_orders')
    .eq('branch_id', entry.branch_id)
    .eq('is_active', true)
    .in('type', types)
    .returns<CounterRow[]>()

  // A kitchen that is off-shift doesn't receive new orders (they skip prep).
  const targets = (counters ?? []).filter(c => c.type !== 'kitchen' || c.accepting_orders)
  if (targets.length === 0) return 0

  const { data: subs } = await supabase
    .from('counter_push_subscriptions')
    .select('id, counter_id, endpoint, p256dh, auth')
    .in('counter_id', targets.map(c => c.id))
    .returns<SubscriptionRow[]>()
  if (!subs?.length) return 0

  const counterById = new Map(targets.map(c => [c.id, c]))
  const dead: string[] = []

  await Promise.all(subs.map(async sub => {
    const counter = counterById.get(sub.counter_id)
    if (!counter) return
    const payload = JSON.stringify({
      counterName: counter.name,
      number: entry.queue_number,
      what: ALERT_PHRASE[counter.type] ?? 'waiting',
      url: `/counter/${counter.counter_token}`,
    })
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { TTL: PUSH_TTL_SECONDS, urgency: 'high' }
      )
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      // 404/410: the browser dropped this subscription for good.
      if (status === 404 || status === 410) dead.push(sub.id)
      else console.error('[push] send failed', status ?? err)
    }
  }))

  if (dead.length) {
    await supabase.from('counter_push_subscriptions').delete().in('id', dead)
  }
  return subs.length - dead.length
}
