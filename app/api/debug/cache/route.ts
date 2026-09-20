import { timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { BOOT_ID, cacheStats } from '@/lib/cache/store'
import { connectionCount } from '@/lib/sse/hub'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/debug/cache   (header: x-debug-token: $DEBUG_TOKEN)
//
// The instrument for verifying the egress fix: hit/miss/coalesced counts for the
// in-process school cache and the live SSE connection count. A healthy deploy
// shows hits >> misses, `entries` plateauing, and streams.total tracking the
// number of devices actually attached.
//
// 404s when DEBUG_TOKEN is unset, so it is inert by default. (Not under a
// leading-underscore folder: those are private folders and are never routed.)
export async function GET(request: NextRequest) {
  const expected = process.env.DEBUG_TOKEN
  const given = request.headers.get('x-debug-token') ?? ''
  if (!expected) return new Response('Not found', { status: 404 })

  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return new Response('Not found', { status: 404 })
  }

  return Response.json({
    boot: BOOT_ID,
    uptimeSeconds: Math.round(process.uptime()),
    cache: cacheStats(),
    streams: connectionCount(),
  })
}
