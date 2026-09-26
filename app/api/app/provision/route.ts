import type { NextRequest } from 'next/server'
import { authenticateAppRequest } from '@/lib/api/app-auth'
import { getAppProvisionData } from '@/lib/dal/app-provision'
import { json } from '@/lib/api/kiosk'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/app/provision   (Authorization: Bearer <accessToken>)
//
// Re-fetch the provisioning payload for the signed-in operator: profile
// (vertical), branches, screens, available languages. Used by the Settings
// screen's refresh and to re-validate a stored session on app boot.
export async function GET(request: NextRequest) {
  const auth = await authenticateAppRequest(request)
  if (!auth.ok) return auth.response

  const prov = await getAppProvisionData(auth.ctx.profile)
  return json({
    profile: prov.profile,
    branches: prov.branches,
    screens: prov.screens,
    services: prov.services,
    availableLanguages: prov.availableLanguages,
  })
}
