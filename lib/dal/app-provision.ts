import 'server-only'
import { createSupabaseServiceClient } from '@/lib/db/server'
import { getAccessibleBranches } from '@/lib/dal/users'
import { regionLocales } from '@/lib/region'
import { buildAppServices, type AppService } from '@/lib/dal/app-services'
import type { CustomerVertical, ProfileDTO, UserRole } from '@/lib/db/types'

// The provisioning payload the native app needs after an operator signs in:
// which product to render (the tenant's one vertical), which facilities the
// operator can pick, and the long device tokens for each. From here on the
// device authenticates to `/api/kiosk/[branchToken]` etc. with the token in the
// path — the operator session is only used to (re)provision and to edit tenant
// settings.

export interface AppProfileSummary {
  vertical: CustomerVertical
  role: UserRole
  customerName: string
  fullName: string
  email: string
}

export interface AppBranchSummary {
  id: string
  name: string
  branchToken: string
}

export interface AppScreenSummary {
  id: string
  name: string
  kind: string
  branchId: string
  screenToken: string
}

export interface AppProvisionData {
  profile: AppProfileSummary
  branches: AppBranchSummary[]
  screens: AppScreenSummary[]
  // What the operator can turn this device into — the app's "choose a service"
  // list. Server-driven so a new hotel service needs no APK release.
  services: AppService[]
  // The locale menu is per-deployment (lib/region.ts) and not the tenant's to
  // change — the app must only offer these for the languages multiselect, or
  // coerceLocales silently drops the rest server-side.
  availableLanguages: string[]
}

export async function getAppProvisionData(profile: ProfileDTO): Promise<AppProvisionData> {
  const branches = await getAccessibleBranches(profile)
  const branchIds = branches.map((b) => b.id)

  let screens: AppScreenSummary[] = []
  if (branchIds.length > 0) {
    const supabase = createSupabaseServiceClient()
    const { data } = await supabase
      .from('screens')
      .select('id, name, kind, branch_id, screen_token, is_active')
      .eq('customer_id', profile.customerId)
      .in('branch_id', branchIds)
      .eq('is_active', true)
      .order('created_at', { ascending: true })

    screens = ((data as Array<{
      id: string
      name: string
      kind: string | null
      branch_id: string
      screen_token: string
    }> | null) ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind ?? 'queue',
      branchId: s.branch_id,
      screenToken: s.screen_token,
    }))
  }

  const vertical = profile.vertical ?? 'business'
  const branchSummaries = branches.map((b) => ({ id: b.id, name: b.name, branchToken: b.branchToken }))

  return {
    profile: {
      vertical,
      role: profile.role,
      customerName: profile.customerName ?? profile.businessName ?? '',
      fullName: profile.fullName,
      email: profile.email,
    },
    branches: branchSummaries,
    screens,
    services: await buildAppServices(vertical, profile.customerId, branchSummaries, screens),
    availableLanguages: regionLocales(),
  }
}
