import 'server-only'
import { cache } from 'react'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/db/server'
import { toProfileDTO, type ProfileDTO } from '@/lib/db/types'
import { getAccessibleBranches } from '@/lib/dal/users'

// Authenticates against the Supabase Auth server (not the raw cookie) — this is
// why we use getUser() and never getSession() on the server.
export const getUser = cache(async () => {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
})

export const requireUser = cache(async () => {
  const user = await getUser()
  if (!user) throw new Error('unauthenticated')
  return user
})

export const getProfile = cache(async (): Promise<ProfileDTO | null> => {
  const user = await getUser()
  if (!user) return null
  return getProfileById(user.id)
})

// The profile lookup on its own, keyed by an already-resolved user id. `getProfile`
// resolves the id from the request cookie; the native-app routes (`/api/app/*`)
// have no cookie — they verify a Bearer token, then call this directly.
export const getProfileById = cache(async (userId: string): Promise<ProfileDTO | null> => {
  // Use service client to bypass recursive RLS on profiles → customers join
  const service = createSupabaseServiceClient()
  const { data, error } = await service
    .from('profiles')
    .select(`
      *,
      customers (
        name,
        business_name,
        primary_color,
        logo_url,
        plan_id,
        plan_expires_at,
        is_active,
        vertical
      )
    `)
    .eq('id', userId)
    .single()

  if (error) {
    console.error('[getProfileById] query error:', error.message, '| user:', userId)
    return null
  }
  if (!data) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = data as any

  return toProfileDTO({
    id: row.id,
    customer_id: row.customer_id,
    email: row.email,
    full_name: row.full_name,
    role: row.role,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
    customer_name: row.customers?.name,
    business_name: row.customers?.business_name,
    primary_color: row.customers?.primary_color,
    logo_url: row.customers?.logo_url,
    plan_id: row.customers?.plan_id,
    plan_expires_at: row.customers?.plan_expires_at,
    customer_active: row.customers?.is_active,
    vertical: row.customers?.vertical,
  })
})

export const requireProfile = cache(async (): Promise<ProfileDTO> => {
  const profile = await getProfile()
  if (!profile) throw new Error('No profile found')
  if (!profile.isActive) throw new Error('Account is deactivated')
  return profile
})

export const requireAdmin = cache(async (): Promise<ProfileDTO> => {
  const profile = await requireProfile()
  if (profile.role !== 'admin') throw new Error('Admin access required')
  return profile
})

export const requireBranchUser = cache(async (): Promise<ProfileDTO> => {
  const profile = await requireProfile()
  if (profile.role !== 'branch_user') throw new Error('Branch user access required')
  return profile
})

// Admins can manage any branch of their customer; branch_users can only
// manage the one branch they're actually assigned to (via user_branches).
// Used by branch-scoped mutation actions (counters, screens, ads, branch
// settings) so a branch_user managing their own branch doesn't hit an
// admin-only throw.
export async function requireBranchManager(branchId: string): Promise<ProfileDTO> {
  const profile = await requireProfile()
  if (profile.role === 'admin') return profile

  const branches = await getAccessibleBranches(profile)
  if (!branches.some((b) => b.id === branchId)) {
    throw new Error('You do not have access to this branch')
  }
  return profile
}

export async function verifyDistributor(): Promise<boolean> {
  const { cookies } = await import('next/headers')
  const cookieStore = await cookies()
  const session = cookieStore.get('dist_session')?.value
  const secret = process.env.DISTRIBUTOR_SECRET
  // An unset secret must deny, not match a missing cookie (undefined === undefined).
  return !!secret && session === secret
}

export async function requireDistributor(): Promise<void> {
  const ok = await verifyDistributor()
  if (!ok) throw new Error('Distributor access required')
}
