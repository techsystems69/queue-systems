import 'server-only'

// In-process, version-gated read cache for the school device surfaces.
//
// WHY THIS EXISTS: the boards, counter consoles and kiosks poll every few
// seconds. Each poll used to hit Supabase, which is what blew the free-tier
// egress quota. Polling this Node process is free; only Supabase egress is
// metered — so polls are answered from memory and only a real change (or the
// TTL backstop) reaches the database.
//
// SINGLE REPLICA ONLY. Version counters and the SSE hub live in this process.
// If Dokploy ever runs 2+ replicas, replica A never learns of replica B's
// mutations and devices on A go stale until the TTL expires. BOOT_ID is logged
// at startup so a doubled log line is the tell.
//
// Everything hangs off globalThis: the RSC render, route handlers and server
// actions can be bundled into separate module registries, so a plain
// module-level Map would give each its own private cache. State is read through
// an accessor on every call so dev-mode HMR (which re-evaluates this module)
// doesn't wipe it.

export const BOOT_ID = Math.random().toString(36).slice(2, 10)

export const MAX_ENTRIES = 500
/** Not-found / expired results are cached briefly so a misconfigured device
 *  can't hammer the database, but not long enough to hide a fix. */
export const NEGATIVE_TTL_MS = 5_000

interface Entry {
  value: unknown
  storedAt: number
  ttlMs: number
  branchId: string | null
  branchVersion: number
  customerId: string | null
  customerVersion: number
}

interface CacheState {
  entries: Map<string, Entry>
  inflight: Map<string, { promise: Promise<unknown>; seq: number }>
  branchVersion: Map<string, number>
  customerVersion: Map<string, number>
  /** Bumped on every invalidation; lets an in-flight load detect it raced one. */
  changeSeq: number
  stats: { hits: number; misses: number; coalesced: number; evictions: number }
}

const KEY = Symbol.for('queue-system.schoolCache')

function state(): CacheState {
  const g = globalThis as unknown as Record<symbol, CacheState | undefined>
  let s = g[KEY]
  if (!s) {
    s = {
      entries: new Map(),
      inflight: new Map(),
      branchVersion: new Map(),
      customerVersion: new Map(),
      changeSeq: 0,
      stats: { hits: 0, misses: 0, coalesced: 0, evictions: 0 },
    }
    g[KEY] = s
    console.log(`[cache] school cache initialised, boot=${BOOT_ID}`)
  }
  return s
}

export interface Loaded<T> {
  value: T
  /** The branch this value depends on, if the loader discovered one. Read from
   *  data the loader already fetched — never a separate lookup. */
  branchId?: string | null
  customerId?: string | null
  /** false for not-found / expired: stored with the short negative TTL and no
   *  version binding. Defaults to true. */
  cacheable?: boolean
}

export function versionOfBranch(branchId: string): number {
  return state().branchVersion.get(branchId) ?? 0
}

export function versionOfCustomer(customerId: string): number {
  return state().customerVersion.get(customerId) ?? 0
}

/** Invalidate every cached read bound to this branch. Synchronous. */
export function bumpBranch(branchId: string): number {
  const s = state()
  const next = (s.branchVersion.get(branchId) ?? 0) + 1
  s.branchVersion.set(branchId, next)
  s.changeSeq++
  return next
}

/** For customer-scoped data (common ads) that feeds every branch's board. */
export function bumpCustomer(customerId: string): number {
  const s = state()
  const next = (s.customerVersion.get(customerId) ?? 0) + 1
  s.customerVersion.set(customerId, next)
  s.changeSeq++
  return next
}

export function dropKey(key: string): void {
  const s = state()
  s.entries.delete(key)
  s.changeSeq++
}

function isFresh(e: Entry, now: number): boolean {
  if (now - e.storedAt >= e.ttlMs) return false
  if (e.branchId !== null && versionOfBranch(e.branchId) !== e.branchVersion) return false
  if (e.customerId !== null && versionOfCustomer(e.customerId) !== e.customerVersion) return false
  return true
}

function evictIfNeeded(s: CacheState) {
  if (s.entries.size <= MAX_ENTRIES) return
  // Drop the oldest 10%. Unreachable with real device counts; it exists so a
  // scanner hitting /api/display/<random> can't grow the map without bound.
  const drop = Math.ceil(MAX_ENTRIES * 0.1)
  const oldest = [...s.entries.entries()]
    .sort((a, b) => a[1].storedAt - b[1].storedAt)
    .slice(0, drop)
  for (const [k] of oldest) s.entries.delete(k)
  s.stats.evictions += oldest.length
}

/**
 * Return the cached value for `key` if it is still fresh, otherwise run
 * `load` (once, however many callers arrive concurrently) and store the result.
 *
 * Fresh means: within the TTL AND the branch/customer version it was stored
 * under hasn't moved. Version gating is what gives an idle branch a ~100% hit
 * rate on a single poller; a pure TTL cache would not.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<Loaded<T>>
): Promise<T> {
  const s = state()
  const now = Date.now()

  const hit = s.entries.get(key)
  if (hit && isFresh(hit, now)) {
    s.stats.hits++
    return hit.value as T
  }

  // Single-flight: a version bump on a branch with several devices would
  // otherwise fire the same query once per device in the same millisecond.
  // Only join a load that started under the CURRENT change counter. One that
  // began before a bump may return pre-mutation data, and a reader arriving
  // after the mutation (e.g. the SSE re-read) must not be handed that.
  const pending = s.inflight.get(key)
  if (pending && pending.seq === s.changeSeq) {
    s.stats.coalesced++
    return pending.promise as Promise<T>
  }

  s.stats.misses++
  // If any bump lands while we are loading, the value we read may predate it.
  // Return it to the callers that asked, but don't store it — the next read
  // reloads. Costs one extra load under concurrent mutation; never serves a
  // stale entry as fresh.
  const seqAtStart = s.changeSeq

  const promise = load()
    .then((loaded) => {
      if (s.changeSeq === seqAtStart) {
        const cacheable = loaded.cacheable !== false
        const branchId = cacheable ? (loaded.branchId ?? null) : null
        const customerId = cacheable ? (loaded.customerId ?? null) : null
        s.entries.set(key, {
          value: loaded.value,
          storedAt: Date.now(),
          ttlMs: cacheable ? ttlMs : NEGATIVE_TTL_MS,
          branchId,
          branchVersion: branchId ? versionOfBranch(branchId) : 0,
          customerId,
          customerVersion: customerId ? versionOfCustomer(customerId) : 0,
        })
        evictIfNeeded(s)
      }
      return loaded.value
    })
    .finally(() => {
      // A newer load may have replaced this slot; only clear our own.
      if (s.inflight.get(key)?.promise === promise) s.inflight.delete(key)
    })

  s.inflight.set(key, { promise, seq: seqAtStart })
  return promise
}

export function cacheStats() {
  const s = state()
  return { ...s.stats, entries: s.entries.size, inflight: s.inflight.size }
}
