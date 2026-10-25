import 'server-only'
import { createSupabaseServiceClient } from '@/lib/db/server'
import { COUNTER_ALERT_TAG, MANAGER_ALERT_TAG } from '@/lib/push/payload'
import { deliverPush, ensureVapid, managerSubscriptionsForBranch, type PushRecipient } from '@/lib/push/deliver'

// Same settle window as the hotel flow: a token transferred or re-called a
// moment after it appeared isn't news.
const SETTLE_MS = 1_500

interface TokenRow {
  id: string
  customer_id: string
  branch_id: string
  department_id: string
  target_counter_id: string | null
  token_code: string
  status: string
}

interface CounterRow {
  id: string
  name_en: string
  counter_token: string
}

interface SubscriptionRow {
  id: string
  counter_id: string
  endpoint: string
  p256dh: string
  auth: string
}

// Called (after the response) by /api/push/notify for one school token that
// just started waiting. Pages the open calling stations that serve its
// department (or the one it is pinned to), and the branch's managers.
export async function notifyForSchoolToken(tokenId: string): Promise<number> {
  if (!ensureVapid()) {
    console.warn('[push] skipped: VAPID env vars are not set on this deployment')
    return 0
  }

  await new Promise(resolve => setTimeout(resolve, SETTLE_MS))

  const supabase = createSupabaseServiceClient()
  const { data: token } = await supabase
    .from('school_tokens')
    .select('id, customer_id, branch_id, department_id, target_counter_id, token_code, status')
    .eq('id', tokenId)
    .maybeSingle<TokenRow>()
  if (!token) {
    console.info('[push] skipped: school token not found', tokenId)
    return 0
  }
  // Re-validate against the live row: it may already have been called.
  if (token.status !== 'waiting') {
    console.info(`[push] skipped: token ${token.token_code} is ${token.status}, no longer waiting`)
    return 0
  }

  const [{ data: dept }, { data: links }] = await Promise.all([
    supabase.from('school_departments').select('name_en').eq('id', token.department_id).maybeSingle<{ name_en: string }>(),
    supabase.from('school_counter_departments').select('counter_id').eq('department_id', token.department_id)
      .returns<{ counter_id: string }[]>(),
  ])

  // Counters that could actually call it: open, active, in this branch, serving
  // the department — and, for a token pinned to one desk, only that desk.
  const candidateIds = (links ?? []).map(l => l.counter_id)
  let counters: CounterRow[] = []
  if (candidateIds.length) {
    let query = supabase
      .from('school_counters')
      .select('id, name_en, counter_token')
      .in('id', candidateIds)
      .eq('branch_id', token.branch_id)
      .eq('is_active', true)
      .eq('is_open', true)
    if (token.target_counter_id) query = query.eq('id', token.target_counter_id)
    counters = (await query.returns<CounterRow[]>()).data ?? []
  }

  const counterRecipients: PushRecipient[] = []
  const counterById = new Map(counters.map(c => [c.id, c]))
  if (counters.length) {
    const { data: subs } = await supabase
      .from('school_counter_push_subscriptions')
      .select('id, counter_id, endpoint, p256dh, auth')
      .in('counter_id', counters.map(c => c.id))
      .returns<SubscriptionRow[]>()
    for (const sub of subs ?? []) {
      const counter = counterById.get(sub.counter_id)
      if (!counter) continue
      counterRecipients.push({
        ...sub,
        payload: {
          heading: counter.name_en,
          label: token.token_code,
          noun: 'token',
          what: 'waiting',
          url: `/school/counter/${counter.counter_token}`,
          tag: COUNTER_ALERT_TAG,
        },
      })
    }
  }

  const managerRecipients: PushRecipient[] = (await managerSubscriptionsForBranch(token.customer_id, token.branch_id))
    .map(sub => ({
      ...sub,
      payload: {
        heading: dept?.name_en ?? 'Queue',
        label: token.token_code,
        noun: 'token' as const,
        what: 'waiting',
        url: '/school/dashboard',
        tag: MANAGER_ALERT_TAG,
      },
    }))

  const recipients = [...counterRecipients, ...managerRecipients]
  if (recipients.length === 0) {
    console.info(
      `[push] skipped: nobody subscribed for token ${token.token_code} — ${counters.length} open counter(s) serve it, ` +
      `0 with a push subscription, 0 managers (turn on the Alerts switch on the counter / bell in the top bar)`
    )
    return 0
  }

  const [sentCounters, sentManagers] = await Promise.all([
    deliverPush('school_counter_push_subscriptions', counterRecipients),
    deliverPush('manager_push_subscriptions', managerRecipients),
  ])
  console.info(`[push] token ${token.token_code}: ${sentCounters} counter device(s), ${sentManagers} manager device(s)`)
  return sentCounters + sentManagers
}
