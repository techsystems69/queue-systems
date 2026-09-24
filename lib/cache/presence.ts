import 'server-only'
import { createSupabaseServiceClient } from '@/lib/db/server'

// Device presence (last_seen_at), decoupled from reads.
//
// get_school_board used to UPDATE screens.last_seen_at on every call, so
// polling WAS the heartbeat. Reads are now served from memory and rarely reach
// Postgres, so presence is written here instead — throttled per token.
//
// 45s is safe: school surfaces only render formatRelativeTime(last_seen_at)
// (lib/queueUtils.ts), which buckets anything under a minute as "Just now".
// There is no binary online/offline threshold for school devices.
//
// A presence write must NEVER bump the branch version — see publishSchoolChange.
export const PRESENCE_WRITE_INTERVAL_MS = 45_000

const KEY = Symbol.for('queue-system.presence')

function lastWritten(): Map<string, number> {
  const g = globalThis as unknown as Record<symbol, Map<string, number> | undefined>
  return (g[KEY] ??= new Map())
}

function due(kind: string, token: string): boolean {
  const map = lastWritten()
  const k = `${kind}:${token}`
  const now = Date.now()
  const prev = map.get(k)
  if (prev !== undefined && now - prev < PRESENCE_WRITE_INTERVAL_MS) return false
  map.set(k, now)
  // Bound the map: prune stale entries when it grows (token fuzzing).
  if (map.size > 1000) {
    for (const [key, at] of map) if (now - at > PRESENCE_WRITE_INTERVAL_MS) map.delete(key)
  }
  return true
}

/** Fire-and-forget. Safe to call on every poll; writes at most once per 45s. */
export async function touchScreen(screenToken: string): Promise<void> {
  if (!due('screen', screenToken)) return
  try {
    // No .select(): PostgREST answers with an empty body (Prefer: return=minimal).
    await createSupabaseServiceClient()
      .from('screens')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('screen_token', screenToken)
      .eq('is_active', true)
  } catch {
    /* Presence is best-effort; never fail a read over it. */
  }
}

export async function touchCounter(counterToken: string): Promise<void> {
  if (!due('counter', counterToken)) return
  try {
    await createSupabaseServiceClient()
      .from('school_counters')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('counter_token', counterToken)
  } catch {
    /* best-effort */
  }
}
