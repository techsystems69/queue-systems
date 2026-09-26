import type { NextRequest } from 'next/server'
import { getBusinessKioskPacket } from '@/lib/dal/business-app'
import { regionLocales } from '@/lib/region'
import { json } from '@/lib/api/kiosk'

export const dynamic = 'force-dynamic'

// GET /api/business-kiosk/[branchToken]/bootstrap
//
// The hotel/restaurant ticket kiosk's one-time load: branch + business branding,
// the switches that decide whether the kiosk may issue numbers at all
// (allowSelfJoin, maxCapacity), the live counters, and the deployment's locale
// menu. Business has no public tracking page, so — unlike school/hospital — no
// publicBaseUrl rides along and the printed ticket carries no QR.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ branchToken: string }> }
) {
  const { branchToken } = await params
  const packet = await getBusinessKioskPacket(branchToken)

  if (packet.status === 'not-found') return json({ error: 'Kiosk is not registered' }, 404)
  if (packet.status === 'expired') return json({ error: 'This subscription has expired' }, 404)

  return json({ ...packet, languages: regionLocales() })
}
