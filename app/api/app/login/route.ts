import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createSupabaseAppClient } from '@/lib/db/server'
import { getProfileById } from '@/lib/dal/session'
import { getAppProvisionData } from '@/lib/dal/app-provision'
import { json, readJsonBody } from '@/lib/api/kiosk'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/app/login   { email, password }
//
// The native app's sign-in. Unlike the web login (SSR cookie flow) this hands
// the Supabase session back in the body for the device to store in secure
// storage. The response also carries everything the setup wizard needs so it
// never has to make a second call: the tenant's vertical, the branches/screens
// the operator can pick, and the long device tokens for each.
//
// Best-effort per-instance IP throttle, same rationale as app/api/pair/route.ts.
const WINDOW_MS = 15 * 60_000
const MAX_ATTEMPTS_PER_IP = 10
const attempts = new Map<string, number[]>()

function throttled(ip: string): boolean {
  const now = Date.now()
  const recent = (attempts.get(ip) ?? []).filter((t) => now - t < WINDOW_MS)
  recent.push(now)
  attempts.set(ip, recent)
  if (attempts.size > 5000) {
    for (const [key, times] of attempts) {
      if (times.every((t) => now - t >= WINDOW_MS)) attempts.delete(key)
    }
  }
  return recent.length > MAX_ATTEMPTS_PER_IP
}

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (throttled(ip)) {
    return json({ error: 'Too many attempts. Wait a few minutes, then try again.' }, 429)
  }

  const body = await readJsonBody<{ email?: string; password?: string }>(request)
  const parsed = LoginSchema.safeParse(body ?? {})
  if (!parsed.success) {
    return json({ error: 'Enter a valid email and password.' }, 400)
  }

  const supabase = createSupabaseAppClient()
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data)
  if (error || !data.session || !data.user) {
    return json({ error: 'Invalid email or password.' }, 401)
  }

  const profile = await getProfileById(data.user.id)
  if (!profile || !profile.isActive) {
    return json({ error: 'This account cannot manage devices.' }, 403)
  }

  const prov = await getAppProvisionData(profile)

  return json({
    session: {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at ?? null,
    },
    profile: prov.profile,
    branches: prov.branches,
    screens: prov.screens,
    services: prov.services,
    availableLanguages: prov.availableLanguages,
  })
}
