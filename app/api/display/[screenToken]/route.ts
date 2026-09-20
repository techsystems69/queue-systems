import { after, type NextRequest } from 'next/server'
import { getSchoolBoard } from '@/lib/dal/school'
import { json } from '@/lib/api/kiosk'
import { touchScreen } from '@/lib/cache/presence'

export const dynamic = 'force-dynamic'

// GET /api/display/[screenToken]
//
// Native-app equivalent of the web waiting-area board at
// /school/display/[screenToken] (components/school/SchoolBoard.tsx). Thin
// wrapper over the same cached `get_school_board` read the web page's server
// action uses (lib/actions/school-read.ts#fetchSchoolBoardAction), so both
// share one in-process cache entry and a poll rarely reaches Supabase.
//
// Presence is NOT a side effect of the RPC any more (the read is usually served
// from memory). It is written separately and throttled — see
// lib/cache/presence.ts — via after() so it never delays the response.
//
// Auth model matches the kiosk routes: the opaque `screen_token` is the only
// credential, carried in the path and re-verified server-side by the RPC —
// never trust a client-supplied screen/branch id.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ screenToken: string }> }
) {
  const { screenToken } = await params
  const packet = await getSchoolBoard(screenToken)

  if (packet.status === 'not-found') {
    return json({ error: 'Display is not registered' }, 404)
  }
  if (packet.status === 'expired') {
    return json({ error: 'Display token has expired' }, 404)
  }

  after(() => touchScreen(screenToken))
  return json(packet)
}
