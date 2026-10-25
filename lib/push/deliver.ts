import 'server-only'
import webpush from 'web-push'
import { createSupabaseServiceClient } from '@/lib/db/server'
import type { PushPayload } from '@/lib/push/payload'

// A page that never reaches the device in 10 minutes is no longer news.
const PUSH_TTL_SECONDS = 600

export type PushTable =
  | 'counter_push_subscriptions'
  | 'school_counter_push_subscriptions'
  | 'manager_push_subscriptions'

export interface PushRecipient {
  // Row id in `table`, used to prune the subscription if the browser drops it.
  id: string
  endpoint: string
  p256dh: string
  auth: string
  payload: PushPayload
}

let vapidReady = false
export function ensureVapid(): boolean {
  if (vapidReady) return true
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT
  if (!publicKey || !privateKey || !subject) return false
  webpush.setVapidDetails(subject, publicKey, privateKey)
  vapidReady = true
  return true
}

// Sends each recipient its payload and prunes subscriptions the push service
// reports as gone (404/410). Returns how many were delivered to the push service.
export async function deliverPush(table: PushTable, recipients: PushRecipient[]): Promise<number> {
  if (recipients.length === 0) return 0
  const dead: string[] = []

  await Promise.all(recipients.map(async r => {
    try {
      await webpush.sendNotification(
        { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
        JSON.stringify(r.payload),
        { TTL: PUSH_TTL_SECONDS, urgency: 'high' }
      )
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) dead.push(r.id)
      else console.error(`[push] send failed (${table})`, status ?? err)
    }
  }))

  if (dead.length) {
    await createSupabaseServiceClient().from(table).delete().in('id', dead)
  }
  return recipients.length - dead.length
}

// Manager subscriptions that should hear about something in `branchId`:
// signed-in admins of the customer (all branches) and branch users assigned to
// that branch — the same visibility the manager pages themselves enforce.
export async function managerSubscriptionsForBranch(customerId: string, branchId: string) {
  const supabase = createSupabaseServiceClient()
  const { data: subs } = await supabase
    .from('manager_push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth')
    .eq('customer_id', customerId)
    .returns<{ id: string; user_id: string; endpoint: string; p256dh: string; auth: string }[]>()
  if (!subs?.length) return []

  const userIds = [...new Set(subs.map(s => s.user_id))]
  const [{ data: profiles }, { data: assigned }] = await Promise.all([
    supabase.from('profiles').select('id, role, is_active').in('id', userIds)
      .returns<{ id: string; role: string; is_active: boolean }[]>(),
    supabase.from('user_branches').select('user_id').eq('branch_id', branchId).in('user_id', userIds)
      .returns<{ user_id: string }[]>(),
  ])
  const assignedIds = new Set((assigned ?? []).map(a => a.user_id))
  const allowed = new Set(
    (profiles ?? [])
      .filter(p => p.is_active && (p.role === 'admin' || assignedIds.has(p.id)))
      .map(p => p.id)
  )
  return subs.filter(s => allowed.has(s.user_id))
}
