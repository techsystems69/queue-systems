'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createSupabaseServiceClient } from '@/lib/db/server'
import { requireDistributor } from '@/lib/dal/session'
import type { CustomerVertical, DistributorStats } from '@/lib/db/types'
import { MAX_SCHOOL_ENTITLEMENT, MAX_HOSPITAL_ENTITLEMENT } from '@/lib/db/types'
import { DEFAULT_VERTICAL, DISTRIBUTOR_VERTICALS, isSellableVertical } from '@/lib/verticals'
import { regionLocales } from '@/lib/region'
import { seedDefaultHospitalDepartments } from '@/lib/hospital/defaultDepartments'

const LICENSE_KEY_VALIDITY_DAYS = 30

function defaultLicenseKeyExpiry(): string {
  return new Date(Date.now() + LICENSE_KEY_VALIDITY_DAYS * 24 * 60 * 60 * 1000).toISOString()
}

// ── Create customer + issue license key ───────────────────────
const VerticalSchema = z
  .enum(DISTRIBUTOR_VERTICALS.map((v) => v.value) as [CustomerVertical, ...CustomerVertical[]])
  .default(DEFAULT_VERTICAL)

const CreateCustomerSchema = z.object({
  businessName: z.string().min(1, 'Business name is required').max(100),
  planId: z.string().min(1, 'Please select a plan'),
  // Which product this customer is being sold. Chosen here, at the point of
  // sale, rather than patched onto the customer after onboarding.
  vertical: VerticalSchema,
})

export async function createCustomerAction(
  _prev: { error?: string; licenseKey?: string },
  formData: FormData
): Promise<{ error?: string; licenseKey?: string }> {
  await requireDistributor()

  const parsed = CreateCustomerSchema.safeParse({
    businessName: formData.get('businessName'),
    planId: formData.get('planId'),
    vertical: formData.get('vertical') ?? undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const service = createSupabaseServiceClient()

  // A plan scoped to another vertical (e.g. Clinic, hospital-only) can't be
  // sold under a different system — the picker already filters these out,
  // this just refuses a client that bypassed it.
  const { data: plan } = await service
    .from('plans')
    .select('*')
    .eq('id', parsed.data.planId)
    .maybeSingle()
  if (!plan) return { error: 'Plan not found' }
  if (plan.vertical && plan.vertical !== parsed.data.vertical) {
    return { error: 'This plan is not available for the selected system' }
  }

  const slug = parsed.data.businessName
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    + '-' + Math.random().toString(36).slice(2, 6)

  // 1. Create customer
  const { data: customer, error: custErr } = await service
    .from('customers')
    .insert({
      name: parsed.data.businessName,
      business_name: parsed.data.businessName,
      slug,
      plan_id: parsed.data.planId,
      vertical: parsed.data.vertical,
      // The hospital plan carries its own department/room ceiling (Clinic
      // 2/4, Hospital 8/15, Multispecialist 30/40) — seed the customer's
      // entitlement from it so the two never start out of sync. Left at the
      // column default for every other plan or vertical.
      ...(parsed.data.vertical === 'hospital' && plan.default_department_limit != null
        ? { max_hospital_departments: plan.default_department_limit }
        : {}),
      ...(parsed.data.vertical === 'hospital' && plan.default_counter_limit != null
        ? { max_hospital_rooms: plan.default_counter_limit }
        : {}),
    })
    .select().single()

  if (custErr || !customer) return { error: 'Failed to create customer' }

  // 2. Create initial branch + queue_state
  const { data: branch } = await service
    .from('branches')
    .insert({ customer_id: customer.id, name: 'Main Branch' })
    .select().single()

  // queue_state is the hotel product's per-branch serving pointer; school and
  // hospital branches serve from many windows/rooms at once and never read it.
  if (branch && parsed.data.vertical === 'business') {
    await service.from('queue_state').insert({ customer_id: customer.id, branch_id: branch.id })
  }

  // A school's name is now provider-owned, so the tenant can no longer type it
  // in on first save. Seed the settings row from the name being sold here, or
  // the TV board and every ticket would print blank until the distributor
  // remembered to fill it in.
  if (branch && parsed.data.vertical === 'school') {
    await service.from('school_settings').insert({
      customer_id: customer.id,
      branch_id: branch.id,
      school_name_en: parsed.data.businessName,
    })
  }

  // Same for hospital: the kiosk ticket and TV board need a name to render.
  // hospital_settings.hospital_name is a jsonb locale map with a required `en`.
  // languages defaults to every locale this market offers (regionLocales()) —
  // the column's own DB default is `{en}`, which otherwise leaves the kiosk
  // picker, the board strip and the announcer silently English-only until an
  // admin visits Settings and ticks the other boxes. A branch that only wants
  // a subset (a Pune clinic that wants Marathi but not Hindi, say) trims it
  // there — this is just a starting point, not a fixed policy.
  // The standard department set is seeded right alongside it — fully
  // translated from the start — so the branch never goes live with an empty
  // department list or English-only cards waiting on someone to click
  // "Seed defaults" by hand.
  if (branch && parsed.data.vertical === 'hospital') {
    await service.from('hospital_settings').insert({
      customer_id: customer.id,
      branch_id: branch.id,
      hospital_name: { en: parsed.data.businessName },
      languages: regionLocales(),
    })
    await seedDefaultHospitalDepartments(service, { customerId: customer.id, branchId: branch.id })
  }

  // 3. Generate a unique license key linked to this customer
  const key = [
    Math.random().toString(36).slice(2, 6).toUpperCase(),
    Math.random().toString(36).slice(2, 6).toUpperCase(),
    Math.random().toString(36).slice(2, 6).toUpperCase(),
    Math.random().toString(36).slice(2, 6).toUpperCase(),
  ].join('-')

  const { error: keyErr } = await service.from('license_keys').insert({
    key,
    plan_id: parsed.data.planId,
    customer_id: customer.id,
    vertical: parsed.data.vertical,
    notes: `Created for ${parsed.data.businessName}`,
    expires_at: defaultLicenseKeyExpiry(),
  })

  if (keyErr) {
    if (branch) await service.from('queue_state').delete().eq('branch_id', branch.id)
    await service.from('branches').delete().eq('customer_id', customer.id)
    await service.from('customers').delete().eq('id', customer.id)
    return { error: 'Failed to generate license key' }
  }

  revalidatePath('/distributor/customers')
  return { licenseKey: key }
}

// ── Generate license key ──────────────────────────────────────
export async function generateLicenseKeyAction(
  planId: string,
  notes?: string,
  vertical: CustomerVertical = DEFAULT_VERTICAL
): Promise<{ error?: string; key?: string }> {
  await requireDistributor()
  if (!isSellableVertical(vertical)) return { error: 'Unknown system' }
  const service = createSupabaseServiceClient()

  const key = [
    Math.random().toString(36).slice(2, 6).toUpperCase(),
    Math.random().toString(36).slice(2, 6).toUpperCase(),
    Math.random().toString(36).slice(2, 6).toUpperCase(),
    Math.random().toString(36).slice(2, 6).toUpperCase(),
  ].join('-')

  const { data, error } = await service.from('license_keys').insert({
    key,
    plan_id: planId,
    vertical,
    notes: notes ?? '',
    expires_at: defaultLicenseKeyExpiry(),
  }).select().single()

  if (error || !data) return { error: 'Failed to generate key' }

  revalidatePath('/distributor')
  revalidatePath('/distributor/keys')
  return { key: data.key }
}

// ── Change the system on an unused key ────────────────────────
// Only while the key is unredeemed. Once used_by is set the tenant exists and
// may already hold rows in that product's tables, so flipping the key would
// leave the customer's vertical and its data disagreeing — the customer would
// open an empty product with its real data stranded in the other one.
export async function setLicenseKeyVerticalAction(
  keyId: string,
  vertical: CustomerVertical
): Promise<{ error?: string }> {
  await requireDistributor()
  if (!isSellableVertical(vertical)) return { error: 'Unknown system' }

  const service = createSupabaseServiceClient()

  const { data: existing } = await service
    .from('license_keys')
    .select('id, used_by, customer_id')
    .eq('id', keyId)
    .maybeSingle()

  if (!existing) return { error: 'Key not found' }
  if ((existing as { used_by: string | null }).used_by) {
    return { error: 'This key has already been redeemed — its system is locked' }
  }

  const { error } = await service
    .from('license_keys')
    .update({ vertical })
    .eq('id', keyId)

  if (error) return { error: 'Could not change the system for this key' }

  // A pre-created customer must move with its key, or redeeming it would hand
  // the customer a product its own row disagrees with.
  const customerId = (existing as { customer_id: string | null }).customer_id
  if (customerId) {
    await service.from('customers').update({ vertical }).eq('id', customerId)
  }

  revalidatePath('/distributor/keys')
  revalidatePath('/distributor/customers')
  return {}
}

// ── Toggle customer active ────────────────────────────────────
export async function toggleCustomerActiveAction(customerId: string): Promise<{ error?: string }> {
  await requireDistributor()
  const service = createSupabaseServiceClient()

  const { data } = await service.from('customers').select('is_active').eq('id', customerId).single()
  if (!data) return { error: 'Customer not found' }

  const { error } = await service
    .from('customers')
    .update({ is_active: !data.is_active, updated_at: new Date().toISOString() })
    .eq('id', customerId)

  if (error) return { error: 'Failed to update customer' }

  revalidatePath('/distributor/customers')
  return {}
}

// ── Change plan ───────────────────────────────────────────────
export async function changePlanAction(customerId: string, planId: string): Promise<{ error?: string }> {
  await requireDistributor()
  const service = createSupabaseServiceClient()

  // Moving a hospital tenant onto a new tier carries its department/room
  // ceiling along (same seeding as create) — a plan change is a resale of
  // capacity, not just a label swap. setCustomerHospitalLimitsAction remains
  // the way to fine-tune away from the tier's defaults afterwards.
  const { data: plan } = await service
    .from('plans')
    .select('*')
    .eq('id', planId)
    .maybeSingle()

  const update: Record<string, unknown> = { plan_id: planId, updated_at: new Date().toISOString() }
  if (plan?.vertical === 'hospital') {
    if (plan.default_department_limit != null) update.max_hospital_departments = plan.default_department_limit
    if (plan.default_counter_limit != null) update.max_hospital_rooms = plan.default_counter_limit
  }

  const { error } = await service
    .from('customers')
    .update(update)
    .eq('id', customerId)

  if (error) return { error: 'Failed to change plan' }

  revalidatePath('/distributor/customers')
  return {}
}

// ── School entitlements ───────────────────────────────────────
// How many departments and counters a school tenant may run, per branch. A new
// customer starts at 1 of each; raising it is a sale, so it lives here rather
// than anywhere the tenant can reach.
//
// Lowering below what the tenant already runs is allowed and deliberately
// non-destructive: existing rows keep working, but no new one can be added
// until they deactivate down to the new ceiling.
const SchoolLimitsSchema = z.object({
  maxSchoolDepartments: z.coerce.number().int().min(0).max(MAX_SCHOOL_ENTITLEMENT),
  maxSchoolCounters: z.coerce.number().int().min(0).max(MAX_SCHOOL_ENTITLEMENT),
  // Public QR-tracking add-on. See
  // supabase/migrations/20260902_school_public_tracking.sql — this is the
  // sale; the school's own on/off switch on /school/settings only takes
  // effect once this is granted.
  publicTrackingEnabled: z.boolean(),
})

export async function setCustomerSchoolLimitsAction(
  customerId: string,
  limits: {
    maxSchoolDepartments: number
    maxSchoolCounters: number
    publicTrackingEnabled: boolean
  }
): Promise<{ error?: string }> {
  await requireDistributor()

  const parsed = SchoolLimitsSchema.safeParse(limits)
  if (!parsed.success) {
    return { error: `Enter a number between 0 and ${MAX_SCHOOL_ENTITLEMENT}` }
  }

  const service = createSupabaseServiceClient()
  const { error } = await service
    .from('customers')
    .update({
      max_school_departments: parsed.data.maxSchoolDepartments,
      max_school_counters: parsed.data.maxSchoolCounters,
      school_public_tracking_enabled: parsed.data.publicTrackingEnabled,
      updated_at: new Date().toISOString(),
    })
    .eq('id', customerId)

  if (error) return { error: 'Could not update the limits' }

  revalidatePath('/distributor/customers')
  return {}
}

// ── School identity ───────────────────────────────────────────
// The name and logo brand the TV board and every printed ticket, so they are
// the provider's to set, not the tenant's. saveSchoolSettingsAction has no
// fields for them at all; this is the only way in.
const SchoolIdentitySchema = z.object({
  branchId: z.string().uuid(),
  // Locale map keyed by locale ({ en, mr, hi } / { en, ar }). The legacy
  // schoolNameEn/schoolNameAr keys are still accepted and folded in.
  schoolName: z.record(z.string(), z.string().max(120)).optional(),
  schoolNameEn: z.string().max(120).optional(),
  schoolNameAr: z.string().max(120).optional(),
  logoUrl: z.string().url('Logo must be a full https:// URL').or(z.literal('')),
})

export async function setSchoolIdentityAction(
  input: z.input<typeof SchoolIdentitySchema>
): Promise<{ error?: string }> {
  await requireDistributor()

  const parsed = SchoolIdentitySchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const d = parsed.data

  // Fold legacy scalars into the map, keep only the market's locales, force en.
  const merged: Record<string, string> = { ...(d.schoolName ?? {}) }
  if (d.schoolNameEn !== undefined) merged.en = d.schoolNameEn
  if (d.schoolNameAr !== undefined) merged.ar = d.schoolNameAr
  const schoolName: Record<string, string> = {}
  for (const l of regionLocales()) {
    const v = (merged[l] ?? '').trim()
    if (v) schoolName[l] = v
  }
  schoolName.en = (merged.en ?? schoolName.en ?? '').trim()
  if (!schoolName.en) return { error: 'School name is required' }

  const service = createSupabaseServiceClient()

  // school_settings.customer_id is NOT NULL, and the branch may have no
  // settings row yet — the tenant may never have opened /school/settings.
  const { data: branch } = await service
    .from('branches')
    .select('id, customer_id')
    .eq('id', d.branchId)
    .maybeSingle()

  if (!branch) return { error: 'Branch not found' }

  const { error } = await service
    .from('school_settings')
    .upsert({
      customer_id: (branch as { customer_id: string }).customer_id,
      branch_id: d.branchId,
      school_name: schoolName,
      school_name_en: schoolName.en,
      school_name_ar: schoolName.ar ?? '',
      logo_url: d.logoUrl,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'branch_id' })

  if (error) return { error: 'Could not save the school identity' }

  revalidatePath('/distributor/customers')
  revalidatePath('/school/settings')
  return {}
}

// ── Hospital entitlements ─────────────────────────────────────
// How many departments and rooms a hospital tenant may run, per branch — the
// same sold-capacity rule as school (see setCustomerSchoolLimitsAction just
// above). createCustomerAction and changePlanAction seed these from the
// chosen plan's default_department_limit/default_counter_limit; this is
// where a distributor fine-tunes away from that default for one customer —
// e.g. a Hospital-tier client who bought two extra rooms.
//
// Lowering below what the tenant already runs is allowed and deliberately
// non-destructive: existing rows keep working, but no new one can be added
// until they deactivate down to the new ceiling.
const HospitalLimitsSchema = z.object({
  maxHospitalDepartments: z.coerce.number().int().min(0).max(MAX_HOSPITAL_ENTITLEMENT),
  maxHospitalRooms: z.coerce.number().int().min(0).max(MAX_HOSPITAL_ENTITLEMENT),
  // Public QR-tracking add-on — same two-question split as school. See
  // getHospitalPublicTrackingGranted in lib/dal/hospital-limits.ts.
  publicTrackingEnabled: z.boolean(),
  // SMS/push notifications add-on. See customers.hospital_notifications_enabled.
  notificationsEnabled: z.boolean(),
})

export async function setCustomerHospitalLimitsAction(
  customerId: string,
  limits: {
    maxHospitalDepartments: number
    maxHospitalRooms: number
    publicTrackingEnabled: boolean
    notificationsEnabled: boolean
  }
): Promise<{ error?: string }> {
  await requireDistributor()

  const parsed = HospitalLimitsSchema.safeParse(limits)
  if (!parsed.success) {
    return { error: `Enter a number between 0 and ${MAX_HOSPITAL_ENTITLEMENT}` }
  }

  const service = createSupabaseServiceClient()
  const { error } = await service
    .from('customers')
    .update({
      max_hospital_departments: parsed.data.maxHospitalDepartments,
      max_hospital_rooms: parsed.data.maxHospitalRooms,
      hospital_public_tracking_enabled: parsed.data.publicTrackingEnabled,
      hospital_notifications_enabled: parsed.data.notificationsEnabled,
      updated_at: new Date().toISOString(),
    })
    .eq('id', customerId)

  if (error) return { error: 'Could not update the limits' }

  revalidatePath('/distributor/customers')
  return {}
}

// ── Edit customer ──────────────────────────────────────────────
// The business-facing profile fields — everything that isn't a plan, a
// vertical (locked to the redeemed key) or a vertical-specific entitlement.
const UpdateCustomerSchema = z.object({
  businessName: z.string().min(1, 'Business name is required').max(100),
  phone: z.string().max(30),
  email: z.string().max(120).refine((v) => v === '' || z.string().email().safeParse(v).success, {
    message: 'Enter a valid email or leave it blank',
  }),
  address: z.string().max(300),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #0F172A'),
  secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #6366F1'),
})

export async function updateCustomerAction(
  customerId: string,
  input: z.input<typeof UpdateCustomerSchema>
): Promise<{ error?: string }> {
  await requireDistributor()

  const parsed = UpdateCustomerSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const service = createSupabaseServiceClient()
  const { error } = await service
    .from('customers')
    .update({
      name: parsed.data.businessName,
      business_name: parsed.data.businessName,
      phone: parsed.data.phone,
      email: parsed.data.email,
      address: parsed.data.address,
      primary_color: parsed.data.primaryColor,
      secondary_color: parsed.data.secondaryColor,
      updated_at: new Date().toISOString(),
    })
    .eq('id', customerId)

  if (error) return { error: 'Could not update the customer' }

  revalidatePath('/distributor/customers')
  return {}
}

// ── Delete customer ────────────────────────────────────────────
// Hard delete — every tenant table references customers.id ON DELETE CASCADE,
// so this permanently removes the customer and everything under it (branches,
// staff, queue history, tokens, patients — all of it). There is no undo.
// The client requires the distributor to type the customer's exact name
// before this is called; expectedName is checked again here so the guard
// can't be skipped by calling the action directly.
export async function deleteCustomerAction(
  customerId: string,
  expectedName: string
): Promise<{ error?: string }> {
  await requireDistributor()
  const service = createSupabaseServiceClient()

  const { data: customer } = await service
    .from('customers')
    .select('name')
    .eq('id', customerId)
    .maybeSingle()

  if (!customer) return { error: 'Customer not found' }
  if (customer.name !== expectedName) {
    return { error: 'Name did not match — nothing was deleted' }
  }

  const { error } = await service.from('customers').delete().eq('id', customerId)
  if (error) return { error: 'Could not delete the customer' }

  revalidatePath('/distributor/customers')
  return {}
}

// ── Distributor stats ─────────────────────────────────────────
export async function getDistributorStats(): Promise<DistributorStats> {
  await requireDistributor()
  const service = createSupabaseServiceClient()

  const { data } = await service.rpc('get_distributor_stats')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stats = data as any
  return {
    totalCustomers: stats?.totalCustomers ?? 0,
    activeCustomers: stats?.activeCustomers ?? 0,
    totalBranches: stats?.totalBranches ?? 0,
    entriesToday: stats?.entriesToday ?? 0,
  }
}
