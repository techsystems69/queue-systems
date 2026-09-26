import type { NextRequest } from 'next/server'
import { authenticateAppRequest, assertBranchOwned } from '@/lib/api/app-auth'
import { createAppScreen } from '@/lib/dal/app-screens'
import { json, readJsonBody } from '@/lib/api/kiosk'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/app/screens   { branchId, name }   (Authorization: Bearer …)
//
// Creates a TV screen for the operator's product and answers with it as a
// display service, ready to bind the device to. This is what makes the app
// standalone: choosing "Announcement display" on a branch with no screens yet
// needs no dashboard visit. Plan quota (max_screens_per_branch) applies exactly
// as it does on the web.
export async function POST(request: NextRequest) {
  const auth = await authenticateAppRequest(request)
  if (!auth.ok) return auth.response

  const body = await readJsonBody<{ branchId?: unknown; name?: unknown }>(request)
  const branchId = typeof body?.branchId === 'string' ? body.branchId.trim() : ''
  const name = typeof body?.name === 'string' ? body.name : ''
  if (!branchId) return json({ error: 'Missing branchId.' }, 400)

  if (!(await assertBranchOwned(auth.ctx.profile, branchId))) {
    return json({ error: 'You do not have access to this branch.' }, 403)
  }

  const result = await createAppScreen(auth.ctx.profile, branchId, name)
  if (result.error || !result.service) {
    return json({ error: result.error ?? 'Could not create the screen.' }, 400)
  }
  return json({ service: result.service })
}
