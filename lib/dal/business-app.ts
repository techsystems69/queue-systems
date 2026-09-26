import 'server-only'
import { cached } from '@/lib/cache/store'
import { BUSINESS_TTL, businessKeys } from '@/lib/cache/businessCache'
import { createSupabaseServiceClient } from '@/lib/db/server'
import {
  toAdDTO, toQueueEntryDTO,
  type DbAd, type DbQueueEntry, type DbTickerMessage, type QueueEntryDTO,
} from '@/lib/db/types'

// Read side of the native app's hotel/restaurant ("business") kiosk and board.
// Both go through the version-gated cache (lib/cache/businessCache.ts): a poll
// is answered from memory and only a real change reaches Supabase.

// Postgres' `current_date` on Supabase is UTC, and get_screen_data filters
// today's entries with `date(joined_at) = current_date`. The kiosk's counts use
// the same day so the two never disagree about who is "waiting".
function startOfTodayUtc(): string {
  return `${new Date().toISOString().slice(0, 10)}T00:00:00Z`
}

// ── Kiosk ────────────────────────────────────────────────────

export interface BusinessKioskPacket {
  status: 'ok' | 'not-found' | 'expired'
  branchId?: string
  branchName?: string
  businessName?: string
  logoUrl?: string
  queueLabel?: string
  allowSelfJoin?: boolean
  maxCapacity?: number
  currentServingNumber?: number
  waitingCount?: number
  isPaused?: boolean
}

export function getBusinessKioskPacket(branchToken: string): Promise<BusinessKioskPacket> {
  return cached(businessKeys.kiosk(branchToken), BUSINESS_TTL.kiosk, async () => {
    const supabase = createSupabaseServiceClient()
    const { data, error } = await supabase.rpc('get_branch_data', { p_branch_token: branchToken })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = data as any
    if (error || !raw) return { value: { status: 'not-found' } as BusinessKioskPacket, cacheable: false }
    if (raw.status === 'expired') return { value: { status: 'expired' } as BusinessKioskPacket, cacheable: false }
    if (raw.status !== 'ok') return { value: { status: 'not-found' } as BusinessKioskPacket, cacheable: false }

    const { count } = await supabase
      .from('queue_entries')
      .select('*', { count: 'exact', head: true })
      .eq('branch_id', raw.branchId)
      .eq('status', 'waiting')
      .gte('joined_at', startOfTodayUtc())

    return {
      value: {
        status: 'ok',
        branchId: raw.branchId,
        branchName: raw.branchName ?? '',
        businessName: raw.businessName ?? '',
        logoUrl: raw.logoUrl ?? '',
        queueLabel: raw.queueLabel ?? 'Queue Number',
        allowSelfJoin: raw.allowSelfJoin ?? true,
        maxCapacity: raw.maxCapacity ?? 100,
        currentServingNumber: raw.currentServingNumber ?? 0,
        waitingCount: count ?? 0,
        isPaused: raw.isPaused ?? false,
      } as BusinessKioskPacket,
      branchId: raw.branchId,
      customerId: raw.customerId,
    }
  })
}

/** Visitors still ahead of `queueNumber` today. Null when it can't be counted —
 *  the ticket then prints without the line rather than with a wrong number. */
export async function countWaitingAhead(branchId: string, queueNumber: number): Promise<number | null> {
  const { count, error } = await createSupabaseServiceClient()
    .from('queue_entries')
    .select('*', { count: 'exact', head: true })
    .eq('branch_id', branchId)
    .eq('status', 'waiting')
    .lt('queue_number', queueNumber)
    .gte('joined_at', startOfTodayUtc())
  return error ? null : (count ?? 0)
}

// ── Board ────────────────────────────────────────────────────

export interface BusinessBoardEntry {
  queueNumber: number
  billNumber: string
}

export interface BusinessBoardPacket {
  status: 'ok' | 'not-found' | 'expired'
  screenName?: string
  branchName?: string
  businessName?: string
  primaryColor?: string
  logoUrl?: string
  queueLabel?: string
  tickerText?: string
  currentServingNumber?: number
  isPaused?: boolean
  /** The entry being served right now, if any. `callCount` moves on every call
   *  AND recall — it is what the board watches to know when to announce. */
  serving?: (BusinessBoardEntry & { entryId: string; callCount: number }) | null
  next?: BusinessBoardEntry[]
  waitingCount?: number
  ads?: Array<{
    id: string
    fileUrl: string
    fileType: 'image' | 'video'
    durationSeconds: number
    audioEnabled: boolean
    placement: 'side' | 'fullscreen'
  }>
  tickers?: Array<{ id: string; message: string }>
  settings?: {
    theme: string
    showAds: boolean
    showTicker: boolean
    showClock: boolean
    announcementLang: string
  }
}

// How many upcoming numbers the board lists. The rest is summarised as a count.
const NEXT_LIMIT = 8

export function getBusinessBoard(screenToken: string): Promise<BusinessBoardPacket> {
  return cached(businessKeys.board(screenToken), BUSINESS_TTL.board, async () => {
    const supabase = createSupabaseServiceClient()
    const { data, error } = await supabase.rpc('get_screen_data', { p_screen_token: screenToken })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = data as any
    if (error || !raw || raw.status === 'not_configured') {
      return { value: { status: 'not-found' } as BusinessBoardPacket, cacheable: false }
    }
    if (raw.status === 'expired') {
      return { value: { status: 'expired' } as BusinessBoardPacket, cacheable: false }
    }

    const entries: QueueEntryDTO[] = ((raw.entries ?? []) as DbQueueEntry[]).map(toQueueEntryDTO)
    const serving = entries.find(
      (e) => e.status === 'in-progress' && e.queueNumber === raw.currentServingNumber
    )
    const waiting = entries
      .filter((e) => e.status === 'waiting')
      .sort((a, b) => a.queueNumber - b.queueNumber)

    // get_screen_data already dropped inactive ads/tickers; placement is a
    // hospital-board feature, so a hotel board keeps every ad in the rail.
    const ads = ((raw.ads ?? []) as DbAd[]).map(toAdDTO)
    const tickers = (raw.tickers ?? []) as DbTickerMessage[]
    const s = raw.settings as Record<string, unknown> | null

    return {
      value: {
        status: 'ok',
        screenName: raw.screenName ?? '',
        branchName: raw.branchName ?? '',
        businessName: raw.businessName ?? '',
        primaryColor: raw.primaryColor ?? '',
        logoUrl: raw.logoUrl ?? '',
        queueLabel: raw.queueLabel ?? 'Queue Number',
        tickerText: raw.tickerText ?? '',
        currentServingNumber: raw.currentServingNumber ?? 0,
        isPaused: raw.isPaused ?? false,
        serving: serving
          ? {
              entryId: serving.id,
              queueNumber: serving.queueNumber,
              billNumber: serving.billNumber,
              callCount: serving.callCount,
            }
          : null,
        next: waiting.slice(0, NEXT_LIMIT).map((e) => ({
          queueNumber: e.queueNumber,
          billNumber: e.billNumber,
        })),
        waitingCount: waiting.length,
        ads: ads.map((a) => ({
          id: a.id,
          fileUrl: a.fileUrl,
          fileType: a.fileType,
          durationSeconds: a.durationSeconds,
          audioEnabled: a.audioEnabled,
          placement: 'side' as const,
        })),
        tickers: tickers.map((t) => ({ id: t.id, message: t.message })),
        settings: {
          theme: (s?.theme as string) ?? 'standard',
          showAds: (s?.show_ads as boolean) ?? true,
          showTicker: (s?.show_ticker as boolean) ?? true,
          showClock: (s?.show_clock as boolean) ?? true,
          announcementLang: (s?.announcement_lang as string) ?? 'en',
        },
      } as BusinessBoardPacket,
      branchId: raw.branchId,
      customerId: raw.customerId,
    }
  })
}
