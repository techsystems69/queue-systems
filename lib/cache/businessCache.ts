import 'server-only'
import { bumpBranch } from '@/lib/cache/store'

// Hotel/restaurant ("business") device reads, on the same version-gated store
// as the school ones (lib/cache/store.ts). The native app's board and kiosk poll
// every few seconds; without this each poll would reach Supabase and repeat the
// egress overrun the school cache was built to stop.
//
// Same RULE as schoolCache: device reads are keyed by the OPAQUE TOKEN, never by
// branchId — the board packet is per-screen (screen_ads overrides, language,
// clock), so a branch key would leak one screen's ads onto another.
export const BUSINESS_TTL = {
  board: 30_000,
  kiosk: 30_000,
} as const

export const businessKeys = {
  board: (screenToken: string) => `business:board:${screenToken}`,
  kiosk: (branchToken: string) => `business:kiosk:${branchToken}`,
} as const

/**
 * Something on this branch changed in a way a device would show (a number was
 * issued, called, completed, cancelled, the queue was reset or paused).
 * Synchronous and in-process; the next poll re-reads.
 *
 * NEVER call this for presence writes — see lib/cache/schoolCache.ts.
 */
export function publishBusinessChange(branchId: string): void {
  bumpBranch(branchId)
}
