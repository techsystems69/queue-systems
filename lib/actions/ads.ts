'use server'

import { revalidatePath } from 'next/cache'
import { publishSchoolChange, publishCustomerChange } from '@/lib/cache/schoolCache'
import { z } from 'zod'
import { createSupabaseServiceClient } from '@/lib/db/server'
import { requireAdmin, requireBranchManager } from '@/lib/dal/session'
import { uploadAdFile, deleteAdFileByUrl } from '@/lib/storage/ads'

const MAX_FILE_BYTES = 25 * 1024 * 1024 // 25MB

const AdFileSchema = z
  .instanceof(File)
  .refine((f) => f.size > 0, 'A file is required')
  .refine((f) => f.size <= MAX_FILE_BYTES, 'File is too large (max 25MB)')
  .refine((f) => f.type.startsWith('image/') || f.type.startsWith('video/'), 'Must be an image or video')

function fileTypeOf(file: File): 'image' | 'video' {
  return file.type.startsWith('video/') ? 'video' : 'image'
}

// ── Create ad ─────────────────────────────────────────────────
const AdSchema = z.object({
  branchId: z.string().uuid(),
  name: z.string().min(1).max(100),
  file: AdFileSchema,
  durationSeconds: z.coerce.number().int().min(3).max(120).optional(),
  // Opt-in sound for video ads on a display that shows one ad at a time.
  // Ignored for images.
  audioEnabled: z.coerce.boolean().default(false),
})

export async function createAdAction(
  _prev: { error?: string },
  formData: FormData
): Promise<{ error?: string }> {
  const parsed = AdSchema.safeParse({
    branchId: formData.get('branchId'),
    name: formData.get('name'),
    file: formData.get('file'),
    durationSeconds: formData.get('durationSeconds') || undefined,
    audioEnabled: formData.get('audioEnabled') === 'on',
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  let profile
  try {
    profile = await requireBranchManager(parsed.data.branchId)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Access denied' }
  }

  const supabase = createSupabaseServiceClient()

  const { data: branch } = await supabase
    .from('branches')
    .select('id')
    .eq('id', parsed.data.branchId)
    .eq('customer_id', profile.customerId)
    .single()

  if (!branch) return { error: 'Branch not found' }

  const { data: last } = await supabase
    .from('ads')
    .select('display_order')
    .eq('branch_id', parsed.data.branchId)
    .order('display_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  const displayOrder = ((last?.display_order ?? 0) as number) + 1

  let uploaded
  try {
    uploaded = await uploadAdFile(parsed.data.file, profile.customerId, parsed.data.branchId)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to upload file' }
  }

  const { error } = await supabase.from('ads').insert({
    customer_id: profile.customerId,
    branch_id: parsed.data.branchId,
    name: parsed.data.name,
    file_url: uploaded.url,
    file_type: fileTypeOf(parsed.data.file),
    file_size_bytes: uploaded.sizeBytes,
    duration_seconds: parsed.data.durationSeconds ?? 8,
    display_order: displayOrder,
    audio_enabled: parsed.data.audioEnabled,
  })

  if (error) return { error: 'Failed to create ad' }

  revalidateAdPaths(parsed.data.branchId)
  return {}
}

// Both products read the same `ads` table: the business ad manager lives at
// /branches/[id]/ads, the school one at /school/ads. Revalidate both so an edit
// from either side is reflected everywhere.
//
// Also the invalidation point for the cached school board: the board packet
// carries the ads and tickers, so any edit here must drop it.
function revalidateAdPaths(branchId: string) {
  revalidatePath(`/branches/${branchId}/ads`)
  revalidatePath('/school/ads')
  publishSchoolChange(branchId)
}

// ── Toggle ad active ──────────────────────────────────────────
export async function toggleAdActiveAction(adId: string, branchId: string): Promise<{ error?: string }> {
  let profile
  try {
    profile = await requireBranchManager(branchId)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Access denied' }
  }
  const supabase = createSupabaseServiceClient()

  const { data: ad } = await supabase
    .from('ads')
    .select('is_active')
    .eq('id', adId)
    .eq('customer_id', profile.customerId)
    .single()

  if (!ad) return { error: 'Ad not found' }

  const { error } = await supabase
    .from('ads')
    .update({ is_active: !ad.is_active, updated_at: new Date().toISOString() })
    .eq('id', adId)
    .eq('customer_id', profile.customerId)

  if (error) return { error: 'Failed to update ad' }

  revalidateAdPaths(branchId)
  return {}
}

// ── Toggle ad audio (video sound) ─────────────────────────────
export async function toggleAdAudioAction(adId: string, branchId: string): Promise<{ error?: string }> {
  let profile
  try {
    profile = await requireBranchManager(branchId)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Access denied' }
  }
  const supabase = createSupabaseServiceClient()

  const { data: ad } = await supabase
    .from('ads')
    .select('audio_enabled')
    .eq('id', adId)
    .eq('customer_id', profile.customerId)
    .single()

  if (!ad) return { error: 'Ad not found' }

  const { error } = await supabase
    .from('ads')
    .update({ audio_enabled: !ad.audio_enabled, updated_at: new Date().toISOString() })
    .eq('id', adId)
    .eq('customer_id', profile.customerId)

  if (error) return { error: 'Failed to update ad' }

  revalidateAdPaths(branchId)
  return {}
}

// ── Delete ad ─────────────────────────────────────────────────
export async function deleteAdAction(adId: string, branchId: string): Promise<{ error?: string }> {
  let profile
  try {
    profile = await requireBranchManager(branchId)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Access denied' }
  }
  const supabase = createSupabaseServiceClient()

  const { data: ad } = await supabase
    .from('ads')
    .select('file_url')
    .eq('id', adId)
    .eq('customer_id', profile.customerId)
    .single()

  const { error } = await supabase
    .from('ads')
    .delete()
    .eq('id', adId)
    .eq('customer_id', profile.customerId)

  if (error) return { error: 'Failed to delete ad' }

  if (ad?.file_url) await deleteAdFileByUrl(ad.file_url)

  revalidateAdPaths(branchId)
  return {}
}

// ── Reorder ads ───────────────────────────────────────────────
export async function reorderAdsAction(branchId: string, orderedIds: string[]): Promise<{ error?: string }> {
  let profile
  try {
    profile = await requireBranchManager(branchId)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Access denied' }
  }
  const supabase = createSupabaseServiceClient()

  await Promise.all(
    orderedIds.map((id, idx) =>
      supabase
        .from('ads')
        .update({ display_order: idx + 1, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('customer_id', profile.customerId)
    )
  )

  revalidateAdPaths(branchId)
  return {}
}

// ── Create ticker message ─────────────────────────────────────
const TickerSchema = z.object({
  branchId: z.string().uuid(),
  message: z.string().min(1).max(500),
})

export async function createTickerAction(
  _prev: { error?: string },
  formData: FormData
): Promise<{ error?: string }> {
  const parsed = TickerSchema.safeParse({
    branchId: formData.get('branchId'),
    message: formData.get('message'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  let profile
  try {
    profile = await requireBranchManager(parsed.data.branchId)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Access denied' }
  }

  const supabase = createSupabaseServiceClient()

  const { data: last } = await supabase
    .from('ticker_messages')
    .select('display_order')
    .eq('branch_id', parsed.data.branchId)
    .order('display_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  const displayOrder = ((last?.display_order ?? 0) as number) + 1

  const { error } = await supabase.from('ticker_messages').insert({
    customer_id: profile.customerId,
    branch_id: parsed.data.branchId,
    message: parsed.data.message,
    display_order: displayOrder,
    is_active: true,
  })

  if (error) return { error: 'Failed to create ticker message' }

  revalidateAdPaths(parsed.data.branchId)
  return {}
}

// ── Toggle ticker active ──────────────────────────────────────
export async function toggleTickerActiveAction(tickerId: string, branchId: string): Promise<{ error?: string }> {
  let profile
  try {
    profile = await requireBranchManager(branchId)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Access denied' }
  }
  const supabase = createSupabaseServiceClient()

  const { data: ticker } = await supabase
    .from('ticker_messages')
    .select('is_active')
    .eq('id', tickerId)
    .eq('customer_id', profile.customerId)
    .single()

  if (!ticker) return { error: 'Ticker not found' }

  const { error } = await supabase
    .from('ticker_messages')
    .update({ is_active: !ticker.is_active })
    .eq('id', tickerId)
    .eq('customer_id', profile.customerId)

  if (error) return { error: 'Failed to update ticker' }

  revalidateAdPaths(branchId)
  return {}
}

// ── Delete ticker message ──────────────────────────────────────
export async function deleteTickerAction(tickerId: string, branchId: string): Promise<{ error?: string }> {
  let profile
  try {
    profile = await requireBranchManager(branchId)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Access denied' }
  }
  const supabase = createSupabaseServiceClient()

  const { error } = await supabase
    .from('ticker_messages')
    .delete()
    .eq('id', tickerId)
    .eq('customer_id', profile.customerId)

  if (error) return { error: 'Failed to delete ticker message' }

  revalidateAdPaths(branchId)
  return {}
}

// ── Create common (customer-wide) ad ───────────────────────────
// Unlike branch-scoped ads, a common ad shows up on every branch's screens
// (unless a screen has its own explicit picks), so this stays admin-only.
const CommonAdSchema = z.object({
  name: z.string().min(1).max(100),
  file: AdFileSchema,
  durationSeconds: z.coerce.number().int().min(3).max(120).optional(),
})

export async function createCommonAdAction(
  _prev: { error?: string },
  formData: FormData
): Promise<{ error?: string }> {
  const profile = await requireAdmin()
  const parsed = CommonAdSchema.safeParse({
    name: formData.get('name'),
    file: formData.get('file'),
    durationSeconds: formData.get('durationSeconds') || undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createSupabaseServiceClient()

  const { data: last } = await supabase
    .from('ads')
    .select('display_order')
    .eq('customer_id', profile.customerId)
    .is('branch_id', null)
    .order('display_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  const displayOrder = ((last?.display_order ?? 0) as number) + 1

  let uploaded
  try {
    uploaded = await uploadAdFile(parsed.data.file, profile.customerId, null)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to upload file' }
  }

  const { error } = await supabase.from('ads').insert({
    customer_id: profile.customerId,
    branch_id: null,
    name: parsed.data.name,
    file_url: uploaded.url,
    file_type: fileTypeOf(parsed.data.file),
    file_size_bytes: uploaded.sizeBytes,
    duration_seconds: parsed.data.durationSeconds ?? 8,
    display_order: displayOrder,
  })

  if (error) return { error: 'Failed to create ad' }

  revalidatePath('/ads')
  // Common ads feed every branch's board through the branch_ad_mode cascade.
  await publishCustomerChange(profile.customerId)
  return {}
}

export async function toggleCommonAdActiveAction(adId: string): Promise<{ error?: string }> {
  const profile = await requireAdmin()
  const supabase = createSupabaseServiceClient()

  const { data: ad } = await supabase
    .from('ads')
    .select('is_active')
    .eq('id', adId)
    .eq('customer_id', profile.customerId)
    .is('branch_id', null)
    .single()

  if (!ad) return { error: 'Ad not found' }

  const { error } = await supabase
    .from('ads')
    .update({ is_active: !ad.is_active, updated_at: new Date().toISOString() })
    .eq('id', adId)
    .eq('customer_id', profile.customerId)

  if (error) return { error: 'Failed to update ad' }

  revalidatePath('/ads')
  // Common ads feed every branch's board through the branch_ad_mode cascade.
  await publishCustomerChange(profile.customerId)
  return {}
}

export async function deleteCommonAdAction(adId: string): Promise<{ error?: string }> {
  const profile = await requireAdmin()
  const supabase = createSupabaseServiceClient()

  const { data: ad } = await supabase
    .from('ads')
    .select('file_url')
    .eq('id', adId)
    .eq('customer_id', profile.customerId)
    .is('branch_id', null)
    .single()

  const { error } = await supabase
    .from('ads')
    .delete()
    .eq('id', adId)
    .eq('customer_id', profile.customerId)
    .is('branch_id', null)

  if (error) return { error: 'Failed to delete ad' }

  if (ad?.file_url) await deleteAdFileByUrl(ad.file_url)

  revalidatePath('/ads')
  // Common ads feed every branch's board through the branch_ad_mode cascade.
  await publishCustomerChange(profile.customerId)
  return {}
}

// ── Pick which ads show on a specific screen ───────────────────
// Leaving a screen with zero explicit picks means it falls back to the
// automatic branch_ad_mode merge (branch + common ads) — see get_screen_data.
export async function setScreenAdsAction(
  screenId: string,
  branchId: string,
  adIds: string[]
): Promise<{ error?: string }> {
  let profile
  try {
    profile = await requireBranchManager(branchId)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Access denied' }
  }

  const supabase = createSupabaseServiceClient()

  const { data: screen } = await supabase
    .from('screens')
    .select('id')
    .eq('id', screenId)
    .eq('branch_id', branchId)
    .eq('customer_id', profile.customerId)
    .single()

  if (!screen) return { error: 'Screen not found' }

  await supabase.from('screen_ads').delete().eq('screen_id', screenId)

  if (adIds.length > 0) {
    const { error } = await supabase.from('screen_ads').insert(
      adIds.map((adId, idx) => ({
        customer_id: profile.customerId,
        screen_id: screenId,
        ad_id: adId,
        display_order: idx,
      }))
    )
    if (error) return { error: 'Failed to update this screen’s ads' }
  }

  revalidatePath(`/branches/${branchId}/screens`)
  // The screen_ads override is part of that screen's cached board packet.
  publishSchoolChange(branchId)
  return {}
}
