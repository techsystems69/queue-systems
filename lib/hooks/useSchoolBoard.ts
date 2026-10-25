'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/db/browser'
import { fetchSchoolBoardAction } from '@/lib/actions/school-read'
import type { SchoolBoardPacket } from '@/lib/db/school-types'
import type { SchoolCallSignal } from '@/lib/actions/school-tokens'

// A call event, plus a monotonic key so an identical re-call still re-mounts
// the overlay and re-fires the announcement — a recall changes no field.
export interface BoardCallEvent extends SchoolCallSignal {
  key: number
}

const POLL_MS = 8000

export function useSchoolBoard(screenToken: string, initial: SchoolBoardPacket) {
  const [packet, setPacket] = useState(initial)
  const [lastCall, setLastCall] = useState<BoardCallEvent | null>(null)
  const callKey = useRef(0)
  // The windows this board lists, read from inside the broadcast handler. A ref
  // rather than a dependency: the subscription must not tear down and rejoin
  // every time a poll replaces the packet.
  const scopeRef = useRef<{ scoped: boolean; counterIds: Set<string> }>({ scoped: false, counterIds: new Set() })
  useEffect(() => {
    scopeRef.current = {
      scoped: packet.scoped === true,
      counterIds: new Set((packet.counters ?? []).map((c) => c.id)),
    }
  }, [packet.scoped, packet.counters])

  const refresh = useCallback(async () => {
    const next = await fetchSchoolBoardAction(screenToken)
    // A transient failure must not blank a wall-mounted board.
    if (next.status === 'ok' || next.status === 'expired') setPacket(next)
  }, [screenToken])

  // State of record. This poll is also the recovery path: a ceiling-mounted TV
  // whose websocket dies has nobody standing there to reload it, and the
  // existing product has no polling anywhere — a dropped socket means a board
  // frozen until someone notices.
  useEffect(() => {
    const id = setInterval(refresh, POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  // Instant call/recall. Note the dependency list includes branchId — the
  // equivalent effect in TVDisplay.tsx closes over branchId but only depends
  // on [announce], so it never resubscribes when the branch changes.
  const branchId = packet.branchId
  useEffect(() => {
    if (!branchId) return
    const supabase = createSupabaseBrowserClient()

    const bump = (payload: SchoolCallSignal) => {
      // A signal with no token code can't be flashed or announced, and acting
      // on one would blank the overlay on a board nobody is standing at. Still
      // re-read, because whatever produced it did change the board's state.
      if (!payload?.tokenCode) {
        refresh()
        return
      }
      // A department/counter display only flashes and speaks its own windows'
      // calls. Signals from an older server carry no counterId and are treated
      // as in scope, which is the pre-scoping behaviour.
      const { scoped, counterIds } = scopeRef.current
      if (scoped && payload.counterId && !counterIds.has(payload.counterId)) {
        refresh()
        return
      }
      callKey.current += 1
      setLastCall({ ...payload, key: callKey.current })
      refresh()
    }

    const channel = supabase
      .channel(`school-display-${branchId}`)
      .on('broadcast', { event: 'token-called' }, ({ payload }) => bump(payload as SchoolCallSignal))
      .on('broadcast', { event: 'token-recalled' }, ({ payload }) => bump(payload as SchoolCallSignal))
      .subscribe((status) => {
        // Re-read on (re)connect so a board that was disconnected catches up
        // immediately rather than waiting out the poll interval.
        if (status === 'SUBSCRIBED') refresh()
      })

    return () => { supabase.removeChannel(channel) }
  }, [branchId, refresh])

  return { packet, lastCall }
}
