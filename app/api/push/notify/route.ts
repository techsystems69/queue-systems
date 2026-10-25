import { timingSafeEqual } from 'node:crypto'
import { after, type NextRequest } from 'next/server'
import { z } from 'zod'
import { notifyCountersForEntry } from '@/lib/push/sendCounterPush'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({ entry_id: z.uuid() })

// POST /api/push/notify   (header: x-push-secret: $PUSH_WEBHOOK_SECRET)
//
// Called by the notify_counter_push() database trigger (via pg_net) whenever a
// queue entry becomes actionable. Replies immediately and does the work in
// after(): the sender waits a moment for the entry to settle, then re-reads it
// so only genuinely valid notifications go out.
//
// 404s when PUSH_WEBHOOK_SECRET is unset or doesn't match, so it is inert by
// default (same convention as /api/debug/cache).
export async function POST(request: NextRequest) {
  const expected = process.env.PUSH_WEBHOOK_SECRET
  const given = request.headers.get('x-push-secret') ?? ''
  if (!expected) return new Response('Not found', { status: 404 })

  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return new Response('Not found', { status: 404 })
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return new Response('Bad request', { status: 400 })

  after(() => notifyCountersForEntry(parsed.data.entry_id).catch(err => console.error('[push]', err)))
  return new Response(null, { status: 202 })
}
