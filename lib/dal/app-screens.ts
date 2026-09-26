import 'server-only'
import { createSupabaseServiceClient } from '@/lib/db/server'
import { displayKindFor, displayService, type AppService } from '@/lib/dal/app-services'
import type { ProfileDTO } from '@/lib/db/types'

// Lets the native app create a TV screen itself, so turning a device into an
// announcement display never needs a trip to the web dashboard.
//
// The web has three create-screen server actions (business, school, hospital),
// all FormData + cookie-guarded and so unusable from the app. They share one
// rule — the plan's max_screens_per_branch — and differ only in `kind`, so this
// is that rule once, with `kind` taken from the operator's product. The caller
// (app/api/app/screens) has already verified the Bearer token and that the
// operator manages `branchId`.
export async function createAppScreen(
  profile: ProfileDTO,
  branchId: string,
  rawName: string
): Promise<{ service?: AppService; error?: string }> {
  const name = rawName.trim().slice(0, 100)
  if (!name) return { error: 'Give the screen a name.' }

  const supabase = createSupabaseServiceClient()

  const { count } = await supabase
    .from('screens')
    .select('*', { count: 'exact', head: true })
    .eq('branch_id', branchId)
    .eq('is_active', true)

  const { data: planData } = await supabase
    .from('customers')
    .select('plans(max_screens_per_branch)')
    .eq('id', profile.customerId)
    .single()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const maxScreens = (planData as any)?.plans?.max_screens_per_branch ?? 2
  if ((count ?? 0) >= maxScreens) {
    return {
      error: `You have reached the maximum number of screens (${maxScreens}) for this branch on your plan.`,
    }
  }

  const { data, error } = await supabase
    .from('screens')
    .insert({
      customer_id: profile.customerId,
      branch_id: branchId,
      name,
      kind: displayKindFor(profile.vertical ?? 'business'),
      orientation: 'landscape',
    })
    .select('id, name, screen_token')
    .single()

  if (error || !data) return { error: 'Could not create the screen.' }

  const row = data as { id: string; name: string; screen_token: string }
  return {
    service: displayService({
      id: row.id,
      name: row.name,
      branchId,
      screenToken: row.screen_token,
    }),
  }
}
