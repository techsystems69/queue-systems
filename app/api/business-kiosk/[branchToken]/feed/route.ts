import type { NextRequest } from 'next/server'
import { getBusinessKioskPacket } from '@/lib/dal/business-app'
import { json } from '@/lib/api/kiosk'

export const dynamic = 'force-dynamic'

// GET /api/business-kiosk/[branchToken]/feed
//
// The kiosk's slow poll: how far the queue has got and how many are waiting.
// Reads the same cached packet as /bootstrap, so a poll costs the database
// nothing until something on the branch actually changes.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ branchToken: string }> }
) {
  const { branchToken } = await params
  const packet = await getBusinessKioskPacket(branchToken)

  if (packet.status !== 'ok') return json({ error: 'Kiosk is not registered' }, 404)

  return json({
    currentServingNumber: packet.currentServingNumber ?? 0,
    waitingCount: packet.waitingCount ?? 0,
    isPaused: packet.isPaused ?? false,
    allowSelfJoin: packet.allowSelfJoin ?? true,
  })
}
