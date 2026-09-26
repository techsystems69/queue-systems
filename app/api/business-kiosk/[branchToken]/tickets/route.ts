import type { NextRequest } from 'next/server'
import { kioskAddEntryAction } from '@/lib/actions/queue'
import { countWaitingAhead } from '@/lib/dal/business-app'
import { json, readJsonBody } from '@/lib/api/kiosk'

export const dynamic = 'force-dynamic'

// POST /api/business-kiosk/[branchToken]/tickets
// Body: { billNumber: string, customerName?: string }
//
// Issues a queue number for a bill/order number — the hotel product's whole
// intake. Wraps kioskAddEntryAction, which re-verifies the branch token,
// honours the self-join and capacity switches and invalidates the board cache.
// The row commits here before the app prints, so a printer failure never loses
// the number. `waitingAhead` is counted as of the moment the number was minted.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ branchToken: string }> }
) {
  const { branchToken } = await params
  const body = await readJsonBody<{ billNumber?: unknown; customerName?: unknown }>(request)

  const billNumber = typeof body?.billNumber === 'string' ? body.billNumber.trim() : ''
  if (!billNumber) return json({ error: 'Enter your bill number.' }, 400)
  if (billNumber.length > 50) return json({ error: 'That bill number is too long.' }, 400)

  const customerName =
    typeof body?.customerName === 'string' ? body.customerName.trim().slice(0, 100) : ''

  const result = await kioskAddEntryAction(branchToken, billNumber, customerName)
  if (result.error || !result.entry) {
    const message = result.error ?? 'Could not issue a number.'
    // Only an unknown branch means "this device is unregistered"; every other
    // rejection (queue full, self-service off) is a business rule the guest reads.
    return json({ error: message }, message === 'Branch not found' ? 404 : 400)
  }

  const e = result.entry
  return json({
    entry: {
      id: e.id,
      queueNumber: e.queueNumber,
      billNumber: e.billNumber,
      customerName: e.customerName,
      joinedAt: e.joinedAt,
    },
    waitingAhead: await countWaitingAhead(e.branchId, e.queueNumber),
  })
}
