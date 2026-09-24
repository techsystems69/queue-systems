'use server'

import { after } from 'next/server'
import { getSchoolBoard, getSchoolCounterView, getSchoolKioskFeed } from '@/lib/dal/school'
import { touchScreen } from '@/lib/cache/presence'
import type {
  SchoolBoardPacket, SchoolKioskFeed, SchoolCounterView as CounterView,
} from '@/lib/db/school-types'

// Re-exported so existing importers keep working; the shape now lives with the
// other DTOs in lib/db/school-types.ts because the DAL builds it.
export type SchoolCounterView = CounterView

// Client-callable reads for the device surfaces.
//
// These exist because the school tables are service-role-only (see the RLS
// note in the migration): a device page can't query them with the publishable
// key, and shouldn't be able to. Broadcast delivers the instant call events;
// these actions are the state of record, polled on a short interval that also
// recovers a screen whose socket dropped.
//
// Every read here is served from the in-process store (lib/cache/store.ts), so
// a poll with no intervening change never reaches Supabase.

export async function fetchSchoolBoardAction(screenToken: string): Promise<SchoolBoardPacket> {
  // Same DAL entry point the native app's route uses, so the web board and the
  // Flutter board share one cache entry.
  const packet = await getSchoolBoard(screenToken)
  // Presence used to be a side effect of the RPC; the read is now cached, so it
  // is written separately (throttled) and off the response path.
  if (packet.status === 'ok') after(() => touchScreen(screenToken))
  return packet
}

export async function fetchSchoolCounterViewAction(counterToken: string): Promise<CounterView> {
  return getSchoolCounterView(counterToken)
}

// ── Kiosk: today's tokens ─────────────────────────────────────
// Thin wrapper so the kiosk can re-poll what its page was server-rendered
// with. The query itself lives in the DAL, where the page reads it too.
export async function fetchSchoolKioskFeedAction(branchToken: string): Promise<SchoolKioskFeed> {
  return getSchoolKioskFeed(branchToken)
}
