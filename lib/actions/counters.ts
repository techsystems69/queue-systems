'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createSupabaseServiceClient } from '@/lib/db/server'
import { requireBranchManager } from '@/lib/dal/session'
import { hasActiveKitchenCounter } from '@/lib/dal/counters'
import { toQueueEntryDTO, toCounterDTO, type CounterDTO, type QueueEntryDTO, type DbCounter, type DbQueueEntry, type DbQueueState, type CounterType } from '@/lib/db/types'
import { publishBusinessChange } from '@/lib/cache/businessCache'

// ── Token auth helper ─────────────────────────────────────────
async function verifyCounterToken(token: string) {
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase
    .from('counters')
    .select('id, customer_id, branch_id, type, is_active')
    .eq('counter_token', token)
    .single()
  if (!data || !data.is_active) return null
  return data as { id: string; customer_id: string; branch_id: string; type: string; is_active: boolean }
}

// If a branch has no active kitchen counter left, any waiting entries still
// sitting at kitchen_status pending/preparing would otherwise be stranded
// forever (nothing left to flip them to 'ready'). Called whenever a kitchen
// counter is deactivated, deleted, or retyped away from 'kitchen'. Logs a
// 'kitchen-bypassed' event so this shows up as a manager-visible flag rather
// than silently behaving like a branch that never had a kitchen stage.
async function releaseStrandedKitchenEntries(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  branchId: string,
  customerId: string
) {
  const { count } = await supabase
    .from('counters')
    .select('id', { count: 'exact', head: true })
    .eq('branch_id', branchId)
    .eq('type', 'kitchen')
    .eq('is_active', true)
    .eq('accepting_orders', true)

  if ((count ?? 0) > 0) return

  const { data: released } = await supabase.from('queue_entries')
    .update({ kitchen_status: 'ready' })
    .eq('branch_id', branchId)
    .eq('status', 'waiting')
    .in('kitchen_status', ['pending', 'preparing'])
    .select('id')

  if (released?.length) {
    await supabase.from('activity_logs').insert({
      customer_id: customerId,
      branch_id: branchId,
      source: 'system',
      type: 'kitchen-bypassed',
      queue_number: 0,
      bill_number: '-',
      message: `Kitchen went offline — ${released.length} order${released.length > 1 ? 's' : ''} bypassed straight to ready`,
    })
    publishBusinessChange(branchId)
  }
}

async function broadcastDisplaySignal(
  branchId: string,
  event: 'customer-called' | 'customer-recalled',
  payload: { queueNumber: number; billNumber: string; callCount: number; announceBillNumber?: boolean }
) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return
  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
        'apikey': key,
      },
      body: JSON.stringify({
        messages: [{ topic: `queue-display-signals-${branchId}`, event, payload }],
      }),
    })
  } catch { /* non-critical */ }
}

// ── Presence heartbeat ──────────────────────────────────────────
// Called periodically by the counter page while it's open in a browser
// tab, so admins/other counters can tell whether staff are actually
// looking at it right now vs. it being left open-but-unattended.
export async function counterHeartbeatAction(counterToken: string): Promise<{ error?: string }> {
  const counter = await verifyCounterToken(counterToken)
  if (!counter) return { error: 'Invalid or inactive counter' }

  const supabase = createSupabaseServiceClient()
  await supabase
    .from('counters')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', counter.id)

  return {}
}

// Kitchen staff self-service shift toggle — flips accepting_orders on their
// own counter without needing branch-manager access. Unlike toggling
// is_active (the counters admin page), this never 404s the console: the
// kitchen tablet stays usable, it just stops feeding new orders into prep.
export async function counterToggleAcceptingOrdersAction(
  counterToken: string
): Promise<{ error?: string; acceptingOrders?: boolean }> {
  const counter = await verifyCounterToken(counterToken)
  if (!counter) return { error: 'Invalid or inactive counter' }
  if (counter.type !== 'kitchen') return { error: 'Only kitchen counters can toggle order acceptance' }

  const supabase = createSupabaseServiceClient()

  const { data: existing } = await supabase
    .from('counters')
    .select('accepting_orders')
    .eq('id', counter.id)
    .single()

  if (!existing) return { error: 'Counter not found' }

  const newValue = !existing.accepting_orders

  const { data, error } = await supabase
    .from('counters')
    .update({ accepting_orders: newValue, updated_at: new Date().toISOString() })
    .eq('id', counter.id)
    .select('accepting_orders')
    .single()

  if (error || !data) return { error: 'Failed to update kitchen status' }

  if (!newValue) {
    await supabase.from('activity_logs').insert({
      customer_id: counter.customer_id,
      branch_id: counter.branch_id,
      source: 'admin',
      type: 'kitchen-bypassed',
      queue_number: 0,
      bill_number: '-',
      message: 'Kitchen marked offline from console — new orders will skip prep',
    })
    publishBusinessChange(counter.branch_id)
    await releaseStrandedKitchenEntries(supabase, counter.branch_id, counter.customer_id)
  }

  revalidatePath(`/branches/${counter.branch_id}/counters`)
  return { acceptingOrders: data.accepting_orders }
}

// ── Counter Queue Actions (authenticated by counter token) ─────

// Kitchen counter updates its own kitchen_status lifecycle
export async function counterUpdateKitchenStatusAction(
  entryId: string,
  branchId: string,
  newStatus: 'preparing' | 'ready',
  counterToken: string
): Promise<{ error?: string }> {
  const counter = await verifyCounterToken(counterToken)
  if (!counter || counter.branch_id !== branchId) return { error: 'Invalid or inactive counter' }
  if (counter.type !== 'kitchen') return { error: 'Only kitchen counters can update kitchen status' }

  const supabase = createSupabaseServiceClient()

  const { data: entryRow } = await supabase
    .from('queue_entries')
    .select('queue_number, bill_number, status')
    .eq('id', entryId)
    .eq('branch_id', branchId)
    .single()

  if (!entryRow) return { error: 'Entry not found' }
  if (entryRow.status !== 'waiting') return { error: 'Order is no longer in queue' }

  await supabase.from('queue_entries')
    .update({ kitchen_status: newStatus })
    .eq('id', entryId)

  await supabase.from('activity_logs').insert({
    customer_id: counter.customer_id,
    branch_id: branchId,
    entry_id: entryId,
    source: 'admin',
    type: 'called',
    queue_number: entryRow.queue_number,
    bill_number: entryRow.bill_number,
    message: `Queue #${entryRow.queue_number} kitchen: ${newStatus}`,
  })
  publishBusinessChange(branchId)

  return {}
}

// Billing and delivery counters call next KITCHEN-READY entry
export async function counterCallNextAction(
  branchId: string,
  counterToken: string
): Promise<{ error?: string }> {
  const counter = await verifyCounterToken(counterToken)
  if (!counter || counter.branch_id !== branchId) return { error: 'Invalid or inactive counter' }
  if (counter.type !== 'billing' && counter.type !== 'delivery') {
    return { error: 'Only billing or delivery counters can call orders' }
  }

  const supabase = createSupabaseServiceClient()
  const now = new Date().toISOString()

  const { data: stateRow } = await supabase
    .from('queue_state')
    .select('current_serving_number')
    .eq('branch_id', branchId)
    .single()

  const currentNumber = (stateRow as DbQueueState | null)?.current_serving_number ?? 0

  if (currentNumber > 0) {
    const { data: cur } = await supabase
      .from('queue_entries')
      .select('*')
      .eq('branch_id', branchId)
      .eq('queue_number', currentNumber)
      .eq('status', 'in-progress')
      .single()

    if (cur) {
      await supabase.from('queue_entries')
        .update({ status: 'completed', completed_at: now })
        .eq('id', cur.id)
      await supabase.from('activity_logs').insert({
        customer_id: counter.customer_id,
        branch_id: branchId,
        entry_id: cur.id,
        source: 'admin',
        type: 'completed',
        queue_number: cur.queue_number,
        bill_number: cur.bill_number,
        message: `Queue #${cur.queue_number} completed via counter`,
      })
      publishBusinessChange(branchId)
    }
  }

  // Only call entries that are kitchen-ready
  const { data: nextRow } = await supabase
    .from('queue_entries')
    .select('*')
    .eq('branch_id', branchId)
    .eq('status', 'waiting')
    .eq('kitchen_status', 'ready')
    .order('queue_number', { ascending: true })
    .limit(1)
    .single()

  if (!nextRow) return {}

  const next = nextRow as DbQueueEntry

  await Promise.all([
    supabase.from('queue_entries')
      .update({ status: 'in-progress', started_at: now, call_count: 1 })
      .eq('id', next.id),
    supabase.from('queue_state')
      .update({ current_serving_number: next.queue_number, updated_at: now })
      .eq('branch_id', branchId),
  ])

  await broadcastDisplaySignal(branchId, 'customer-called', {
    queueNumber: next.queue_number,
    billNumber: next.bill_number,
    callCount: 1,
  })

  await supabase.from('activity_logs').insert({
    customer_id: counter.customer_id,
    branch_id: branchId,
    entry_id: next.id,
    source: 'admin',
    type: 'called',
    queue_number: next.queue_number,
    bill_number: next.bill_number,
    message: `Queue #${next.queue_number} called via ${counter.type} counter`,
  })
  publishBusinessChange(branchId)

  return {}
}

// Call or recall a specific entry (billing/delivery counters).
// First call on a waiting, kitchen-ready entry brings it "to the counter";
// calling the same in-progress entry again counts as a recall.
export async function counterCallEntryAction(
  entryId: string,
  branchId: string,
  counterToken: string
): Promise<{ error?: string }> {
  const counter = await verifyCounterToken(counterToken)
  if (!counter || counter.branch_id !== branchId) return { error: 'Invalid or inactive counter' }
  if (counter.type !== 'billing' && counter.type !== 'delivery' && counter.type !== 'call') {
    return { error: 'Only billing, delivery, or call counters can call/recall orders' }
  }

  const supabase = createSupabaseServiceClient()
  const now = new Date().toISOString()

  const { data: entryRow } = await supabase
    .from('queue_entries')
    .select('*')
    .eq('id', entryId)
    .eq('branch_id', branchId)
    .single()

  if (!entryRow) return { error: 'Entry not found' }
  const entry = entryRow as DbQueueEntry

  if (entry.status !== 'waiting' && entry.status !== 'in-progress') {
    return { error: 'Order is no longer in queue' }
  }
  if (entry.status === 'waiting' && entry.kitchen_status !== 'ready') {
    return { error: 'Order is not ready yet' }
  }

  const newCallCount = (entry.call_count ?? 0) + 1
  const isRecall = entry.status === 'in-progress'

  const { data: stateRow } = await supabase
    .from('queue_state')
    .select('current_serving_number')
    .eq('branch_id', branchId)
    .single()

  const currentNumber = (stateRow as DbQueueState | null)?.current_serving_number ?? 0

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ops: PromiseLike<any>[] = [
    supabase.from('queue_entries').update({
      call_count: newCallCount,
      ...(isRecall
        ? { recall_count: (entry.recall_count ?? 0) + 1 }
        : { status: 'in-progress', started_at: now }),
    }).eq('id', entry.id),
  ]

  if (!isRecall) {
    if (currentNumber > 0 && currentNumber !== entry.queue_number) {
      ops.push(
        supabase.from('queue_entries')
          .update({ status: 'completed', completed_at: now })
          .eq('branch_id', branchId)
          .eq('queue_number', currentNumber)
          .eq('status', 'in-progress')
      )
    }
    ops.push(
      supabase.from('queue_state')
        .update({ current_serving_number: entry.queue_number, updated_at: now })
        .eq('branch_id', branchId)
    )
  }

  await Promise.all(ops)

  await broadcastDisplaySignal(branchId, isRecall ? 'customer-recalled' : 'customer-called', {
    queueNumber: entry.queue_number,
    billNumber: entry.bill_number,
    callCount: newCallCount,
    announceBillNumber: counter.type === 'call',
  })

  await supabase.from('activity_logs').insert({
    customer_id: counter.customer_id,
    branch_id: branchId,
    entry_id: entry.id,
    source: 'admin',
    type: isRecall ? 'recalled' : 'called',
    queue_number: entry.queue_number,
    bill_number: entry.bill_number,
    message: isRecall
      ? `Queue #${entry.queue_number} recalled via ${counter.type} counter (×${newCallCount})`
      : `Queue #${entry.queue_number} called via ${counter.type} counter`,
  })
  publishBusinessChange(branchId)

  return {}
}

export async function counterCompleteEntryAction(
  entryId: string,
  branchId: string,
  counterToken: string
): Promise<{ error?: string }> {
  const counter = await verifyCounterToken(counterToken)
  if (!counter || counter.branch_id !== branchId) return { error: 'Invalid or inactive counter' }
  if (counter.type !== 'billing' && counter.type !== 'delivery' && counter.type !== 'call') {
    return { error: 'Only billing, delivery, or call counters can complete orders' }
  }

  const supabase = createSupabaseServiceClient()
  const now = new Date().toISOString()

  const { data: entryRow } = await supabase
    .from('queue_entries')
    .select('*')
    .eq('id', entryId)
    .eq('branch_id', branchId)
    .single()

  if (!entryRow) return { error: 'Entry not found' }
  const entry = entryRow as DbQueueEntry

  await supabase.from('queue_entries')
    .update({ status: 'completed', completed_at: now })
    .eq('id', entryId)

  await supabase.from('activity_logs').insert({
    customer_id: counter.customer_id,
    branch_id: branchId,
    entry_id: entryId,
    source: 'admin',
    type: 'completed',
    queue_number: entry.queue_number,
    bill_number: entry.bill_number,
    message: `Queue #${entry.queue_number} completed via counter`,
  })
  publishBusinessChange(branchId)

  return {}
}

export interface CounterEntryActionResult {
  error?: string
  entry?: QueueEntryDTO
}

// Order counter creates new queue entries — the walk-up "take an order, hand
// out a queue number" stage that feeds every other counter type. Delivery
// counters may also create one directly (skipping the kitchen stage) when
// staff search for a bill that never made it into the queue.
export async function counterCreateEntryAction(
  branchId: string,
  counterToken: string,
  billNumber: string,
  customerName = '',
  phone = ''
): Promise<CounterEntryActionResult> {
  if (!billNumber.trim()) return { error: 'Bill number is required' }

  const counter = await verifyCounterToken(counterToken)
  if (!counter || counter.branch_id !== branchId) return { error: 'Invalid or inactive counter' }
  if (counter.type !== 'order' && counter.type !== 'delivery' && counter.type !== 'call') {
    return { error: 'Only order, delivery, or call counters can create new entries' }
  }

  const supabase = createSupabaseServiceClient()

  const { data: numData, error: numErr } = await supabase.rpc('claim_queue_number', {
    p_branch_id: branchId,
  })
  if (numErr || numData == null) return { error: 'Failed to assign queue number' }

  const queueNumber = numData as number
  // A delivery or call counter creating an entry is registering a bill that's
  // already made — skip the kitchen stage so it's immediately callable.
  const needsKitchen = counter.type === 'delivery' || counter.type === 'call'
    ? false
    : await hasActiveKitchenCounter(branchId)

  const { data, error } = await supabase
    .from('queue_entries')
    .insert({
      customer_id: counter.customer_id,
      branch_id: branchId,
      queue_number: queueNumber,
      bill_number: billNumber.trim(),
      customer_name: customerName,
      phone,
      status: 'waiting',
      kitchen_status: needsKitchen ? 'pending' : 'ready',
      source: 'admin',
    })
    .select()
    .single()

  if (error || !data) return { error: 'Failed to create entry' }

  const entry = toQueueEntryDTO(data as DbQueueEntry)

  await supabase.from('activity_logs').insert({
    customer_id: counter.customer_id,
    branch_id: branchId,
    entry_id: entry.id,
    source: 'admin',
    type: 'joined',
    queue_number: queueNumber,
    bill_number: billNumber.trim(),
    message: `Queue #${queueNumber} joined — Bill ${billNumber.trim()} (${counter.type} counter)`,
  })
  publishBusinessChange(branchId)

  revalidatePath('/dashboard')
  revalidatePath(`/branches/${branchId}`)
  return { entry }
}

export async function counterCancelEntryAction(
  entryId: string,
  branchId: string,
  counterToken: string
): Promise<{ error?: string }> {
  const counter = await verifyCounterToken(counterToken)
  if (!counter || counter.branch_id !== branchId) return { error: 'Invalid or inactive counter' }

  const supabase = createSupabaseServiceClient()

  const { data: entryRow } = await supabase
    .from('queue_entries')
    .select('queue_number, bill_number')
    .eq('id', entryId)
    .eq('branch_id', branchId)
    .single()

  if (!entryRow) return { error: 'Entry not found' }

  await supabase.from('queue_entries')
    .update({ status: 'cancelled' })
    .eq('id', entryId)

  await supabase.from('activity_logs').insert({
    customer_id: counter.customer_id,
    branch_id: branchId,
    entry_id: entryId,
    source: 'admin',
    type: 'cancelled',
    queue_number: entryRow.queue_number,
    bill_number: entryRow.bill_number,
    message: `Queue #${entryRow.queue_number} cancelled via counter`,
  })
  publishBusinessChange(branchId)

  return {}
}

export interface CounterActionResult {
  error?: string
  counter?: CounterDTO
}

const CreateCounterSchema = z.object({
  branchId: z.string().uuid(),
  name: z.string().min(1, 'Counter name is required').max(100),
  type: z.enum(['order', 'billing', 'kitchen', 'delivery', 'call']),
})

// ── Create counter ────────────────────────────────────────────
export async function createCounterAction(
  _prev: CounterActionResult,
  formData: FormData
): Promise<CounterActionResult> {
  const parsed = CreateCounterSchema.safeParse({
    branchId: formData.get('branchId'),
    name: formData.get('name'),
    type: formData.get('type'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  let profile
  try {
    profile = await requireBranchManager(parsed.data.branchId)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Access denied' }
  }

  const supabase = createSupabaseServiceClient()

  // Verify branch belongs to customer
  const { data: branch } = await supabase
    .from('branches')
    .select('id')
    .eq('id', parsed.data.branchId)
    .eq('customer_id', profile.customerId)
    .single()

  if (!branch) return { error: 'Branch not found' }

  const { data, error } = await supabase
    .from('counters')
    .insert({
      customer_id: profile.customerId,
      branch_id: parsed.data.branchId,
      name: parsed.data.name,
      type: parsed.data.type,
    })
    .select()
    .single()

  if (error || !data) return { error: 'Failed to create counter' }

  revalidatePath(`/branches/${parsed.data.branchId}/counters`)
  return { counter: toCounterDTO(data as DbCounter) }
}

// ── Toggle counter active/inactive ────────────────────────────
export async function toggleCounterAction(
  counterId: string,
  branchId: string
): Promise<{ error?: string; isActive?: boolean }> {
  let profile
  try {
    profile = await requireBranchManager(branchId)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Access denied' }
  }
  const supabase = createSupabaseServiceClient()

  const { data: existing } = await supabase
    .from('counters')
    .select('is_active, type')
    .eq('id', counterId)
    .eq('customer_id', profile.customerId)
    .single()

  if (!existing) return { error: 'Counter not found' }

  const { data, error } = await supabase
    .from('counters')
    .update({ is_active: !existing.is_active, updated_at: new Date().toISOString() })
    .eq('id', counterId)
    .eq('customer_id', profile.customerId)
    .select('is_active')
    .single()

  if (error || !data) return { error: 'Failed to update counter' }

  if (existing.type === 'kitchen' && !data.is_active) {
    await releaseStrandedKitchenEntries(supabase, branchId, profile.customerId)
  }

  revalidatePath(`/branches/${branchId}/counters`)
  return { isActive: data.is_active }
}

// ── Update counter name/type ───────────────────────────────────
const UpdateCounterSchema = z.object({
  counterId: z.string().uuid(),
  branchId: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  type: z.enum(['order', 'billing', 'kitchen', 'delivery', 'call']).optional(),
})

export async function updateCounterAction(
  _prev: CounterActionResult,
  formData: FormData
): Promise<CounterActionResult> {
  const parsed = UpdateCounterSchema.safeParse({
    counterId: formData.get('counterId'),
    branchId: formData.get('branchId'),
    name: formData.get('name') || undefined,
    type: (formData.get('type') as CounterType) || undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  let profile
  try {
    profile = await requireBranchManager(parsed.data.branchId)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Access denied' }
  }

  const supabase = createSupabaseServiceClient()
  const { counterId, branchId, ...updates } = parsed.data

  const { data: existing } = await supabase
    .from('counters')
    .select('type')
    .eq('id', counterId)
    .eq('customer_id', profile.customerId)
    .single()

  const { data, error } = await supabase
    .from('counters')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', counterId)
    .eq('customer_id', profile.customerId)
    .select()
    .single()

  if (error || !data) return { error: 'Failed to update counter' }

  if (existing?.type === 'kitchen' && updates.type && updates.type !== 'kitchen') {
    await releaseStrandedKitchenEntries(supabase, branchId, profile.customerId)
  }

  revalidatePath(`/branches/${branchId}/counters`)
  return { counter: toCounterDTO(data as DbCounter) }
}

// ── Delete counter ─────────────────────────────────────────────
export async function deleteCounterAction(
  counterId: string,
  branchId: string
): Promise<{ error?: string }> {
  let profile
  try {
    profile = await requireBranchManager(branchId)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Access denied' }
  }
  const supabase = createSupabaseServiceClient()

  const { data: existing } = await supabase
    .from('counters')
    .select('type')
    .eq('id', counterId)
    .eq('customer_id', profile.customerId)
    .single()

  const { error } = await supabase
    .from('counters')
    .delete()
    .eq('id', counterId)
    .eq('customer_id', profile.customerId)

  if (error) return { error: 'Failed to delete counter' }

  if (existing?.type === 'kitchen') {
    await releaseStrandedKitchenEntries(supabase, branchId, profile.customerId)
  }

  revalidatePath(`/branches/${branchId}/counters`)
  return {}
}
