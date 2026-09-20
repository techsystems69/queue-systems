import 'server-only'

// In-process fan-out from "a branch changed" to every open SSE connection on it.
//
// A plain Map<branchId, Set<listener>> rather than EventEmitter: Node warns at
// 11 listeners per event name, and silencing that with setMaxListeners(0)
// throws away a useful leak detector. The connection count is exposed for the
// debug route instead. Same globalThis rule and single-replica caveat as
// lib/cache/store.ts.

import type { SchoolCallSignal } from '@/lib/actions/school-tokens'

export type SchoolChangeKind = 'change' | 'call' | 'recall'

export interface SchoolBranchEvent {
  branchId: string
  /** The branch version after this change — doubles as the SSE event id. */
  v: number
  kind: SchoolChangeKind
  signal?: SchoolCallSignal
}

type Listener = (evt: SchoolBranchEvent) => void

/** Past this, new streams get a 503. A reconnect loop can't OOM the box. */
export const MAX_STREAMS = 200

const KEY = Symbol.for('queue-system.sseHub')

function listeners(): Map<string, Set<Listener>> {
  const g = globalThis as unknown as Record<symbol, Map<string, Set<Listener>> | undefined>
  return (g[KEY] ??= new Map())
}

export function connectionCount(): { total: number; byBranch: Record<string, number> } {
  const byBranch: Record<string, number> = {}
  let total = 0
  for (const [branchId, set] of listeners()) {
    byBranch[branchId] = set.size
    total += set.size
  }
  return { total, byBranch }
}

/** Returns an unsubscribe fn, or null when the stream cap is reached. */
export function subscribeBranch(branchId: string, fn: Listener): (() => void) | null {
  if (connectionCount().total >= MAX_STREAMS) return null
  const map = listeners()
  let set = map.get(branchId)
  if (!set) {
    set = new Set()
    map.set(branchId, set)
  }
  set.add(fn)
  return () => {
    const cur = map.get(branchId)
    if (!cur) return
    cur.delete(fn)
    // Drop empty sets so the map doesn't accumulate dead branches.
    if (cur.size === 0) map.delete(branchId)
  }
}

export function emitBranch(evt: SchoolBranchEvent): void {
  const set = listeners().get(evt.branchId)
  if (!set) return
  // Copy: a listener may unsubscribe (stream closed) while we iterate.
  for (const fn of [...set]) {
    try {
      fn(evt)
    } catch (err) {
      console.error('[sse] listener threw', err)
    }
  }
}
