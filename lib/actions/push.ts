'use server'

import { z } from 'zod'
import { createSupabaseServiceClient } from '@/lib/db/server'
import { getProfile } from '@/lib/dal/session'

const subscriptionSchema = z.object({
  endpoint: z.url().refine(u => u.startsWith('https://'), 'Push endpoint must be https'),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(256),
  }),
})

async function counterIdForToken(token: string) {
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase
    .from('counters')
    .select('id, is_active')
    .eq('counter_token', token)
    .single()
  return data && data.is_active ? (data.id as string) : null
}

// Counter pages have no login — the token in the URL is the credential, same
// as every other counter action. Upserting on endpoint means re-subscribing
// (or a tablet being reassigned to another counter) simply moves the row.
export async function savePushSubscriptionAction(
  counterToken: string,
  subscription: unknown,
  userAgent?: string
): Promise<{ error?: string }> {
  const parsed = subscriptionSchema.safeParse(subscription)
  if (!parsed.success) return { error: 'Invalid push subscription' }

  const counterId = await counterIdForToken(counterToken)
  if (!counterId) return { error: 'Invalid or inactive counter' }

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase.from('counter_push_subscriptions').upsert(
    {
      counter_id: counterId,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      user_agent: userAgent?.slice(0, 300) ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' }
  )
  if (error) return { error: 'Could not save push subscription' }
  return {}
}

export async function removePushSubscriptionAction(
  counterToken: string,
  endpoint: string
): Promise<{ error?: string }> {
  const counterId = await counterIdForToken(counterToken)
  if (!counterId) return { error: 'Invalid or inactive counter' }

  const supabase = createSupabaseServiceClient()
  await supabase
    .from('counter_push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .eq('counter_id', counterId)
  return {}
}

// ── School calling stations ───────────────────────────────────
async function schoolCounterIdForToken(token: string) {
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase
    .from('school_counters')
    .select('id, is_active')
    .eq('counter_token', token)
    .maybeSingle()
  return data && data.is_active ? (data.id as string) : null
}

export async function saveSchoolCounterPushAction(
  counterToken: string,
  subscription: unknown,
  userAgent?: string
): Promise<{ error?: string }> {
  const parsed = subscriptionSchema.safeParse(subscription)
  if (!parsed.success) return { error: 'Invalid push subscription' }

  const counterId = await schoolCounterIdForToken(counterToken)
  if (!counterId) return { error: 'Invalid or inactive counter' }

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase.from('school_counter_push_subscriptions').upsert(
    {
      counter_id: counterId,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      user_agent: userAgent?.slice(0, 300) ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' }
  )
  if (error) return { error: 'Could not save push subscription' }
  return {}
}

export async function removeSchoolCounterPushAction(
  counterToken: string,
  endpoint: string
): Promise<{ error?: string }> {
  const counterId = await schoolCounterIdForToken(counterToken)
  if (!counterId) return { error: 'Invalid or inactive counter' }

  const supabase = createSupabaseServiceClient()
  await supabase
    .from('school_counter_push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .eq('counter_id', counterId)
  return {}
}

// ── Managers (signed-in admin panels) ─────────────────────────
// Unlike counters these are authenticated: the subscription is tied to the
// signed-in user and their customer, never to a URL token.
export async function saveManagerPushAction(
  subscription: unknown,
  userAgent?: string
): Promise<{ error?: string }> {
  const parsed = subscriptionSchema.safeParse(subscription)
  if (!parsed.success) return { error: 'Invalid push subscription' }

  const profile = await getProfile()
  if (!profile?.isActive) return { error: 'Not signed in' }

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase.from('manager_push_subscriptions').upsert(
    {
      user_id: profile.id,
      customer_id: profile.customerId,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      user_agent: userAgent?.slice(0, 300) ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' }
  )
  if (error) return { error: 'Could not save push subscription' }
  return {}
}

export async function removeManagerPushAction(endpoint: string): Promise<{ error?: string }> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not signed in' }

  const supabase = createSupabaseServiceClient()
  await supabase
    .from('manager_push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .eq('user_id', profile.id)
  return {}
}
