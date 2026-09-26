import type { NextRequest } from 'next/server'
import { getBusinessBoard } from '@/lib/dal/business-app'
import { json } from '@/lib/api/kiosk'

export const dynamic = 'force-dynamic'

// GET /api/business-display/[screenToken]
//
// Native-app equivalent of /display/[token] (components/display/TVDisplay.tsx)
// for the hotel/restaurant product. The web board listens on Supabase realtime;
// the app polls this instead, served from the version-gated cache — so a 3s poll
// on a ceiling-mounted TV costs the database nothing until a number is called.
// Presence (screens.last_seen_at) is written by get_screen_data on a cache miss,
// which happens at least every TTL.
//
// Auth model matches the other device routes: the opaque screen_token is the
// only credential, carried in the path and re-verified by the RPC.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ screenToken: string }> }
) {
  const { screenToken } = await params
  const packet = await getBusinessBoard(screenToken)

  if (packet.status === 'not-found') return json({ error: 'Display is not registered' }, 404)
  if (packet.status === 'expired') return json({ error: 'This subscription has expired' }, 404)

  return json(packet)
}
