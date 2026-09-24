import 'server-only'
import { bumpBranch, bumpCustomer } from '@/lib/cache/store'
import { createSupabaseServiceClient } from '@/lib/db/server'
import { emitBranch, type SchoolChangeKind } from '@/lib/sse/hub'
import type { SchoolCallSignal } from '@/lib/actions/school-tokens'

// TTLs are deliberately generous. Version gating (lib/cache/store.ts) does the
// real invalidation on every app-side mutation; the TTL only bounds staleness
// from changes that bypass the app (a SQL-editor edit) and the service-date
// rollover, which happens at day_start_time when nobody is at a window.
export const TTL = {
  board: 30_000,
  counterView: 30_000,
  kioskFeed: 30_000,
  departments: 300_000,
  serviceDate: 60_000,
} as const

// Cache keys. RULE: device reads are keyed by the OPAQUE TOKEN, never by
// branchId. The board packet is per-screen (screen_ads overrides, language,
// clock), so keying by branch would leak one screen's ads onto another.
export const keys = {
  board: (screenToken: string) => `school:board:${screenToken}`,
  counterView: (counterToken: string) => `school:counter:${counterToken}`,
  kioskFeed: (branchToken: string) => `school:kiosk:${branchToken}`,
  departments: (branchId: string) => `school:depts:${branchId}`,
  serviceDate: (branchId: string) => `school:svcdate:${branchId}`,
} as const

/**
 * Something on this branch changed in a way a device would show. Invalidates
 * every cached read bound to the branch and wakes every open SSE stream on it.
 * Synchronous and in-process.
 *
 * NEVER call this for presence writes (last_seen_at heartbeats). Counter
 * last_seen_at is in the board packet but nothing renders it; if heartbeats
 * bumped the version, every console would invalidate every board in its branch
 * every 20s and the cache would be worthless.
 */
export function publishSchoolChange(
  branchId: string,
  kind: SchoolChangeKind = 'change',
  signal?: SchoolCallSignal
): void {
  const v = bumpBranch(branchId)
  emitBranch({ branchId, v, kind, signal })
}

/**
 * Customer-scoped change (common ads, which the branch_ad_mode cascade folds
 * into every branch's board). Bumps the customer version — dropping every board
 * entry that carries this customerId — and then notifies each of the customer's
 * branches so open SSE streams re-read. One small query on a rare admin action.
 */
export async function publishCustomerChange(customerId: string): Promise<void> {
  bumpCustomer(customerId)
  try {
    const { data } = await createSupabaseServiceClient()
      .from('branches')
      .select('id')
      .eq('customer_id', customerId)
    for (const b of (data ?? []) as { id: string }[]) publishSchoolChange(b.id)
  } catch {
    // The version bump above already invalidated the cache; only the SSE nudge
    // is lost, and the fallback poll covers it.
  }
}
