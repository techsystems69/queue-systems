import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export async function createSupabaseServerClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Ignore: called from Server Component — set by action/route handler
          }
        },
      },
    }
  )
}

// One shared client. It is stateless — no session persisted, no token refresh,
// no per-request auth — so reusing it is safe, and constructing a fresh one per
// call (the counter console alone made up to four per poll) is pure CPU/GC
// churn on a small VPS. Parked on globalThis so every module registry Next
// bundles shares it, and keyed by URL+key so a config change is picked up.
const SERVICE_CLIENT = Symbol.for('queue-system.serviceClient')

function makeServiceClient(url: string, key: string) {
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}
type ServiceClient = ReturnType<typeof makeServiceClient>

export function createSupabaseServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const g = globalThis as unknown as Record<symbol, { id: string; client: ServiceClient } | undefined>
  const id = `${url}|${key}`
  const held = g[SERVICE_CLIENT]
  if (held && held.id === id) return held.client
  const client = makeServiceClient(url, key)
  g[SERVICE_CLIENT] = { id, client }
  return client
}

// Cookie-free auth client for the native app (`/api/app/*`). Unlike the SSR
// client above it never reads or writes cookies, so `signInWithPassword` /
// `refreshSession` hand the access + refresh tokens back in the response body
// for the device to store itself, and `auth.getUser(token)` verifies a Bearer
// token straight against the Auth server. Publishable key only — every data
// read/write in those routes still goes through the service client, scoped to
// the customer the verified token belongs to.
export function createSupabaseAppClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
