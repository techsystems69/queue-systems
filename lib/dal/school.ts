import 'server-only'
import { cache } from 'react'
import { createSupabaseServiceClient } from '@/lib/db/server'
import {
  toSchoolSettingsDTO, toSchoolDepartmentDTO, toSchoolCounterDTO,
  toSchoolTokenDTO, toSchoolActivityLogDTO, toLocaleMap,
  type SchoolSettingsDTO, type SchoolDepartmentDTO, type SchoolCounterDTO,
  type SchoolTokenDTO, type SchoolActivityLogDTO, type SchoolBoardPacket,
  type SchoolKioskDTO, type SchoolScreenDTO, type DbSchoolKiosk,
  type SchoolDashboardStats, type SchoolDepartmentStats, type SchoolKioskFeed,
  type DbSchoolSettings, type DbSchoolDepartment, type DbSchoolCounter,
  type DbSchoolToken, type DbSchoolActivityLog, type SchoolBranchIdentity,
  type PublicTicketStatus, type SchoolCounterView,
} from '@/lib/db/school-types'
import { cached } from '@/lib/cache/store'
import { keys, TTL } from '@/lib/cache/schoolCache'
import { SCHOOL_TOKEN_PAGE_SIZE } from '@/lib/school/constants'
import { getSchoolPublicTrackingEnabled } from '@/lib/dal/school-limits'

// Reads use the service-role client and rely on the requireX() guards in
// lib/dal/session.ts — RLS in this schema is self-referentially broken, so the
// school tables follow the same rule as `counters` (service-role-only policy).

// ── Service date ──────────────────────────────────────────────
// Always ask Postgres. Deriving "today" in JS is what makes the existing
// dashboard disagree with the data before 03:00 Qatar time.
//
// Cached across requests for a minute, TTL only: a mutation never moves the
// service date, so binding it to the branch version would just cost an extra
// RPC after every change. It flips at day_start_time, when nobody is at a window.
export const getSchoolServiceDate = cache(async (branchId: string): Promise<string> =>
  cached(keys.serviceDate(branchId), TTL.serviceDate, async () => {
    const supabase = createSupabaseServiceClient()
    const { data } = await supabase.rpc('school_service_date', { p_branch_id: branchId })
    return { value: (data as string | null) ?? new Date().toISOString().slice(0, 10) }
  })
)

// ── Settings ──────────────────────────────────────────────────
export const getSchoolSettings = cache(async (branchId: string): Promise<SchoolSettingsDTO | null> => {
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase
    .from('school_settings')
    .select('*')
    .eq('branch_id', branchId)
    .maybeSingle()

  return data ? toSchoolSettingsDTO(data as DbSchoolSettings) : null
})

// ── Departments ───────────────────────────────────────────────
export const getSchoolDepartments = cache(async (
  branchId: string,
  opts: { activeOnly?: boolean } = {}
): Promise<SchoolDepartmentDTO[]> => {
  const supabase = createSupabaseServiceClient()
  let query = supabase
    .from('school_departments')
    .select('*')
    .eq('branch_id', branchId)

  if (opts.activeOnly) query = query.eq('is_active', true)

  const { data } = await query
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true })

  return (data as DbSchoolDepartment[] ?? []).map(toSchoolDepartmentDTO)
})

// ── Counters ──────────────────────────────────────────────────
export const getSchoolCounters = cache(async (branchId: string): Promise<SchoolCounterDTO[]> => {
  const supabase = createSupabaseServiceClient()
  const [{ data: counters }, { data: links }] = await Promise.all([
    supabase
      .from('school_counters')
      .select('*')
      .eq('branch_id', branchId)
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('school_counter_departments')
      .select('counter_id, department_id, preference')
      .order('preference', { ascending: true }),
  ])

  const byCounter = new Map<string, string[]>()
  for (const link of (links ?? []) as { counter_id: string; department_id: string }[]) {
    const list = byCounter.get(link.counter_id) ?? []
    list.push(link.department_id)
    byCounter.set(link.counter_id, list)
  }

  return (counters as DbSchoolCounter[] ?? []).map((row) => ({
    ...toSchoolCounterDTO(row),
    departmentIds: byCounter.get(row.id) ?? [],
  }))
})

export const getSchoolCounterByToken = cache(async (token: string): Promise<SchoolCounterDTO | null> => {
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase
    .from('school_counters')
    .select('*')
    .eq('counter_token', token)
    .maybeSingle()

  if (!data) return null

  const { data: links } = await supabase
    .from('school_counter_departments')
    .select('department_id')
    .eq('counter_id', (data as DbSchoolCounter).id)
    .order('preference', { ascending: true })

  return {
    ...toSchoolCounterDTO(data as DbSchoolCounter),
    departmentIds: ((links ?? []) as { department_id: string }[]).map((l) => l.department_id),
  }
})

// ── Kiosk resolution (token auth, no session) ─────────────────
// A kiosk URL carries one of two credentials:
//   * the branch's own branch_token — the original kiosk, offers every
//     department and issues unpinned tokens;
//   * a school_kiosks.kiosk_token — an individually addressed kiosk that is
//     scoped to some departments, or dedicated to one counter.
// Everything a kiosk does (bootstrap, feed, issue, amend) resolves the token
// here first, so scope is enforced in exactly one place.
export interface ResolvedSchoolKiosk {
  branchId: string
  branchName: string
  customerId: string
  silentPrint: boolean
  printerName: string
  /** null for the branch-token kiosk. */
  kioskId: string | null
  kioskName: string | null
  /** Set for a dedicated desk kiosk: tokens it issues are pinned here. */
  counterId: string | null
  counterName: string | null
  /** Departments this kiosk may offer or touch; null = every department. */
  departmentIds: string[] | null
}

export async function resolveSchoolKiosk(
  token: string
): Promise<ResolvedSchoolKiosk | { status: 'not-found' | 'inactive' }> {
  const supabase = createSupabaseServiceClient()

  const branchSelect = 'id, name, customer_id, is_active, silent_print, printer_name'
  type BranchRow = {
    id: string; name: string; customer_id: string
    is_active: boolean; silent_print: boolean; printer_name: string
  }

  const { data: kioskRow } = await supabase
    .from('school_kiosks')
    .select('*')
    .eq('kiosk_token', token)
    .eq('is_active', true)
    .maybeSingle()

  if (kioskRow) {
    const kiosk = kioskRow as DbSchoolKiosk
    const { data: branch } = await supabase
      .from('branches').select(branchSelect).eq('id', kiosk.branch_id).maybeSingle()
    const b = branch as BranchRow | null
    if (!b) return { status: 'not-found' }
    if (!b.is_active) return { status: 'inactive' }

    let departmentIds: string[] | null = null
    let counterName: string | null = null

    if (kiosk.counter_id) {
      const [{ data: counter }, { data: links }] = await Promise.all([
        supabase.from('school_counters')
          .select('name_en, is_active').eq('id', kiosk.counter_id).maybeSingle(),
        supabase.from('school_counter_departments')
          .select('department_id').eq('counter_id', kiosk.counter_id)
          .order('preference', { ascending: true }),
      ])
      // A desk kiosk whose desk was switched off must stop issuing: its tokens
      // are pinned to a counter nobody is sitting at.
      if (!counter || !(counter as { is_active: boolean }).is_active) {
        return { status: 'inactive' }
      }
      counterName = (counter as { name_en: string }).name_en
      departmentIds = ((links ?? []) as { department_id: string }[]).map((l) => l.department_id)
    } else {
      const { data: links } = await supabase
        .from('school_kiosk_departments').select('department_id').eq('kiosk_id', kiosk.id)
      const ids = ((links ?? []) as { department_id: string }[]).map((l) => l.department_id)
      departmentIds = ids.length > 0 ? ids : null
    }

    return {
      branchId: b.id, branchName: b.name, customerId: b.customer_id,
      silentPrint: b.silent_print, printerName: b.printer_name,
      kioskId: kiosk.id, kioskName: kiosk.name,
      counterId: kiosk.counter_id, counterName,
      departmentIds,
    }
  }

  const { data: branch } = await supabase
    .from('branches').select(branchSelect).eq('branch_token', token).maybeSingle()
  const b = branch as BranchRow | null
  if (!b) return { status: 'not-found' }
  if (!b.is_active) return { status: 'inactive' }

  return {
    branchId: b.id, branchName: b.name, customerId: b.customer_id,
    silentPrint: b.silent_print, printerName: b.printer_name,
    kioskId: null, kioskName: null, counterId: null, counterName: null,
    departmentIds: null,
  }
}

/** True when `departmentId` is something this kiosk is allowed to offer. */
export function kioskOffers(kiosk: ResolvedSchoolKiosk, departmentId: string): boolean {
  return kiosk.departmentIds === null || kiosk.departmentIds.includes(departmentId)
}

// ── Kiosk bootstrap ───────────────────────────────────────────
export interface SchoolKioskPacket {
  status: 'ok' | 'not-found' | 'inactive'
  branchId?: string
  branchName?: string
  customerId?: string
  departments?: SchoolDepartmentDTO[]
  settings?: SchoolSettingsDTO | null
  silentPrint?: boolean
  printerName?: string
  // Effective public-tracking gate (distributor grant AND the school's own
  // switch) — see lib/dal/school-limits.ts. The app only prints a QR when
  // this is true.
  publicTrackingEnabled?: boolean
  // Set for a kiosk that is not the branch-wide one. `counterName` is present
  // for a dedicated desk kiosk, so the screen can say which window it feeds.
  kioskName?: string
  counterName?: string
  scoped?: boolean
}

export const getSchoolKioskPacket = cache(async (kioskToken: string): Promise<SchoolKioskPacket> => {
  const kiosk = await resolveSchoolKiosk(kioskToken)
  if ('status' in kiosk) return { status: kiosk.status }

  const [allDepartments, settings, publicTrackingEnabled] = await Promise.all([
    getSchoolDepartments(kiosk.branchId, { activeOnly: true }),
    getSchoolSettings(kiosk.branchId),
    getSchoolPublicTrackingEnabled(kiosk.customerId, kiosk.branchId),
  ])

  // Counter-linked order (the manager's preference) is kept for a desk kiosk
  // by walking the id list; otherwise the branch's display order stands.
  const departments = kiosk.departmentIds === null
    ? allDepartments
    : kiosk.counterId
      ? kiosk.departmentIds
          .map((id) => allDepartments.find((d) => d.id === id))
          .filter((d): d is SchoolDepartmentDTO => d !== undefined)
      : allDepartments.filter((d) => kiosk.departmentIds!.includes(d.id))

  return {
    status: 'ok',
    branchId: kiosk.branchId,
    branchName: kiosk.branchName,
    customerId: kiosk.customerId,
    departments,
    settings,
    silentPrint: kiosk.silentPrint,
    printerName: kiosk.printerName,
    publicTrackingEnabled,
    ...(kiosk.kioskId && {
      kioskName: kiosk.kioskName ?? undefined,
      counterName: kiosk.counterName ?? undefined,
      scoped: true,
    }),
  }
})

// ── TV board ──────────────────────────────────────────────────
//
// Served from memory (lib/cache/store.ts): the TV polls this every few seconds
// and each miss is a Supabase read. Keyed by screenToken because the packet is
// per-screen (screen_ads overrides, language, clock). The RPC no longer bumps
// screens.last_seen_at — presence is written separately by lib/cache/presence.ts.
export const getSchoolBoard = cache(async (screenToken: string): Promise<SchoolBoardPacket> =>
  cached(keys.board(screenToken), TTL.board, async () => {
    const supabase = createSupabaseServiceClient()
    const { data, error } = await supabase.rpc('get_school_board', { p_screen_token: screenToken })

    if (error || !data) return { value: { status: 'not-found' } as SchoolBoardPacket, cacheable: false }
    const packet = data as SchoolBoardPacket
    return {
      value: packet,
      branchId: packet.branchId ?? null,
      customerId: packet.customerId ?? null,
      // not-found / expired get the short negative TTL, unbound to a version.
      cacheable: packet.status === 'ok',
    }
  })
)

// ── Cached department list ────────────────────────────────────
// Active departments for a branch, shared by the counter console's 'issuable'
// list and its lane names so each poll doesn't re-read them.
export const getCachedActiveDepartments = (branchId: string): Promise<SchoolDepartmentDTO[]> =>
  cached(keys.departments(branchId), TTL.departments, async () => ({
    value: await getSchoolDepartments(branchId, { activeOnly: true }),
    branchId,
  }))

// ── Public ticket tracking (public_code auth, no session) ─────
// What the QR on a printed ticket points at. Not cache()'d: the public page
// polls this repeatedly for the same request-lifetime-free interval timer, so
// per-request memoization buys nothing here (each poll is its own request).
export async function getPublicTicketStatus(code: string): Promise<PublicTicketStatus> {
  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase.rpc('get_public_ticket_status', { p_code: code })

  if (error || !data) return { status: 'not-found' }
  return data as PublicTicketStatus
}

// ── Tokens ────────────────────────────────────────────────────
export const getTodaySchoolTokens = cache(async (branchId: string): Promise<SchoolTokenDTO[]> => {
  const serviceDate = await getSchoolServiceDate(branchId)
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase
    .from('school_tokens')
    .select('*')
    .eq('branch_id', branchId)
    .eq('service_date', serviceDate)
    .order('joined_at', { ascending: true })

  return (data as DbSchoolToken[] ?? []).map(toSchoolTokenDTO)
})

export interface SchoolTokenFilters {
  from?: string
  to?: string
  departmentId?: string
  status?: string
  search?: string
}

export async function getSchoolTokensPage(
  branchId: string,
  filters: SchoolTokenFilters,
  page = 1
): Promise<{ tokens: SchoolTokenDTO[]; total: number }> {
  const supabase = createSupabaseServiceClient()
  let query = supabase
    .from('school_tokens')
    .select('*', { count: 'exact' })
    .eq('branch_id', branchId)

  if (filters.from) query = query.gte('service_date', filters.from)
  if (filters.to) query = query.lte('service_date', filters.to)
  if (filters.departmentId) query = query.eq('department_id', filters.departmentId)
  if (filters.status && filters.status !== 'all') query = query.eq('status', filters.status)
  if (filters.search) {
    // Strip PostgREST filter metacharacters — same guard as the activity log
    // search in lib/dal/queue.ts.
    const term = filters.search.trim().replace(/[,()%*]/g, '')
    if (term) query = query.ilike('token_code', `%${term}%`)
  }

  const offset = (page - 1) * SCHOOL_TOKEN_PAGE_SIZE
  const { data, count } = await query
    .order('joined_at', { ascending: false })
    .range(offset, offset + SCHOOL_TOKEN_PAGE_SIZE - 1)

  return {
    tokens: (data as DbSchoolToken[] ?? []).map(toSchoolTokenDTO),
    total: count ?? 0,
  }
}

// ── Activity ──────────────────────────────────────────────────
export const getSchoolActivity = cache(async (branchId: string, limit = 30): Promise<SchoolActivityLogDTO[]> => {
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase
    .from('school_activity_logs')
    .select('*')
    .eq('branch_id', branchId)
    .order('created_at', { ascending: false })
    .limit(limit)

  return (data as DbSchoolActivityLog[] ?? []).map(toSchoolActivityLogDTO)
})

// ── Dashboard ─────────────────────────────────────────────────
// Wait time is called_at − joined_at: how long the visitor actually waited.
// (getDashboardStats in lib/dal/queue.ts measures completed_at − started_at,
// which is service duration, and labels it wait — don't copy that.)
export async function getSchoolDashboardStats(branchId: string): Promise<SchoolDashboardStats> {
  const [tokens, departments] = await Promise.all([
    getTodaySchoolTokens(branchId),
    getSchoolDepartments(branchId, { activeOnly: true }),
  ])

  const waitMinutes = (t: SchoolTokenDTO): number | null => {
    if (!t.calledAt) return null
    return Math.round((new Date(t.calledAt).getTime() - new Date(t.joinedAt).getTime()) / 60000)
  }

  const avgOf = (list: SchoolTokenDTO[]): number => {
    const waits = list.map(waitMinutes).filter((m): m is number => m !== null && m >= 0)
    if (waits.length === 0) return 0
    return Math.round(waits.reduce((a, b) => a + b, 0) / waits.length)
  }

  const byDepartment: SchoolDepartmentStats[] = departments.map((dept) => {
    const list = tokens.filter((t) => t.departmentId === dept.id)
    return {
      departmentId: dept.id,
      nameEn: dept.nameEn,
      nameAr: dept.nameAr,
      color: dept.color,
      total: list.length,
      waiting: list.filter((t) => t.status === 'waiting' || t.status === 'held').length,
      served: list.filter((t) => t.status === 'served').length,
      noShow: list.filter((t) => t.status === 'no-show').length,
      avgWaitMinutes: avgOf(list),
    }
  })

  return {
    totalTokens: tokens.length,
    waiting: tokens.filter((t) => t.status === 'waiting' || t.status === 'held').length,
    called: tokens.filter((t) => t.status === 'called').length,
    served: tokens.filter((t) => t.status === 'served').length,
    noShow: tokens.filter((t) => t.status === 'no-show').length,
    cancelled: tokens.filter((t) => t.status === 'cancelled').length,
    avgWaitMinutes: avgOf(tokens),
    byDepartment,
  }
}

// ── Kiosk feed ────────────────────────────────────────────────
// The rail on the lobby kiosk: the tail of today's tokens, newest first — the
// rail exists to correct the tap that just happened, so the row someone is
// reaching for is the top one, not the oldest in the queue.
//
// Not React cache()d: the kiosk polls this through a server action and needs the
// current row set, not the one memoised for the request that rendered it. It IS
// held in the in-process store (version-gated on the branch), so a poll with no
// intervening change never reaches Supabase.
const KIOSK_RECENT_LIMIT = 30

export async function getSchoolKioskFeed(branchToken: string): Promise<SchoolKioskFeed> {
  return cached(keys.kioskFeed(branchToken), TTL.kioskFeed, () => loadSchoolKioskFeed(branchToken))
}

async function loadSchoolKioskFeed(
  kioskToken: string
): Promise<{ value: SchoolKioskFeed; branchId?: string; cacheable?: boolean }> {
  const supabase = createSupabaseServiceClient()

  const kiosk = await resolveSchoolKiosk(kioskToken)
  if ('status' in kiosk) return { value: { status: 'not-found' }, cacheable: false }
  const branchId = kiosk.branchId

  // A scoped kiosk's rail and queue depths cover only what it offers — and a
  // desk kiosk only the tokens pinned to its counter. A scope that resolved to
  // no departments has nothing to count.
  if (kiosk.departmentIds !== null && kiosk.departmentIds.length === 0) {
    return {
      branchId,
      value: {
        status: 'ok', serviceDate: await getSchoolServiceDate(branchId),
        recent: [], waitingByDepartment: {}, waitingTotal: 0, issuedToday: 0,
        kioskId: kiosk.kioskId ?? undefined,
      },
    }
  }

  const serviceDate = await getSchoolServiceDate(branchId)

  // PostgREST's builder generics blow up tsc when threaded through a helper,
  // so the filter is applied to an untyped builder.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scope = (q: any) => {
    let out = q
    if (kiosk.departmentIds !== null) out = out.in('department_id', kiosk.departmentIds)
    if (kiosk.counterId) out = out.eq('target_counter_id', kiosk.counterId)
    return out
  }

  const [{ data: recent }, { data: waiting }, { count: issuedToday }] = await Promise.all([
    scope(
      supabase
        .from('school_tokens')
        .select('*')
        .eq('branch_id', branchId)
        .eq('service_date', serviceDate)
    )
      .order('joined_at', { ascending: false })
      .limit(KIOSK_RECENT_LIMIT),
    // Only the department column: this is a depth count per tile, and pulling
    // whole rows for a queue that can be hundreds long is wasted bandwidth on
    // a 6-second poll.
    scope(
      supabase
        .from('school_tokens')
        .select('department_id')
        .eq('branch_id', branchId)
        .eq('service_date', serviceDate)
        .in('status', ['waiting', 'held'])
    ),
    scope(
      supabase
        .from('school_tokens')
        .select('*', { count: 'exact', head: true })
        .eq('branch_id', branchId)
        .eq('service_date', serviceDate)
    ),
  ])

  const waitingRows = (waiting ?? []) as { department_id: string }[]
  const waitingByDepartment: Record<string, number> = {}
  for (const row of waitingRows) {
    waitingByDepartment[row.department_id] = (waitingByDepartment[row.department_id] ?? 0) + 1
  }

  return {
    branchId,
    value: {
      status: 'ok',
      serviceDate,
      recent: ((recent ?? []) as DbSchoolToken[]).map(toSchoolTokenDTO),
      waitingByDepartment,
      waitingTotal: waitingRows.length,
      issuedToday: issuedToday ?? 0,
      kioskId: kiosk.kioskId ?? undefined,
    },
  }
}

// ── Counter console view ──────────────────────────────────────
// What a counter terminal shows: its lane, its current token, the no-shows.
// Polled every 15s per open console. Cold, it is up to 8 round trips; held in
// the in-process store it is zero until the branch changes.
//
// Reads that used to be per-poll and are now shared: the service date (cached
// across requests) and the branch's active departments (cached, and reused to
// name this counter's lanes instead of a second `.in('id', …)` query).
export const getSchoolCounterView = (counterToken: string): Promise<SchoolCounterView> =>
  cached(keys.counterView(counterToken), TTL.counterView, () => loadSchoolCounterView(counterToken))

async function loadSchoolCounterView(
  counterToken: string
): Promise<{ value: SchoolCounterView; branchId?: string; cacheable?: boolean }> {
  const supabase = createSupabaseServiceClient()

  const { data: counter } = await supabase
    .from('school_counters')
    .select('id, branch_id, name_en, name_ar, is_open, is_active, accepts_priority')
    .eq('counter_token', counterToken)
    .maybeSingle()

  if (!counter || !(counter as { is_active: boolean }).is_active) {
    return { value: { status: 'not-found' }, cacheable: false }
  }

  const c = counter as {
    id: string; branch_id: string; name_en: string; name_ar: string
    is_open: boolean; accepts_priority: boolean
  }

  const [serviceDate, activeDepartments, { data: links }] = await Promise.all([
    getSchoolServiceDate(c.branch_id),
    getCachedActiveDepartments(c.branch_id),
    supabase
      .from('school_counter_departments')
      .select('department_id, preference')
      .eq('counter_id', c.id)
      .order('preference', { ascending: true }),
  ])

  const departmentIds = ((links ?? []) as { department_id: string }[]).map((l) => l.department_id)

  const [{ data: current }, { data: waiting }, { data: noShows }, { count: servedToday }] =
    await Promise.all([
      supabase
        .from('school_tokens')
        .select('*')
        .eq('counter_id', c.id)
        .eq('status', 'called')
        .maybeSingle(),
      departmentIds.length
        ? supabase
            .from('school_tokens')
            .select('*')
            .eq('branch_id', c.branch_id)
            .eq('service_date', serviceDate)
            .in('department_id', departmentIds)
            .in('status', ['waiting', 'held'])
            .or(`target_counter_id.is.null,target_counter_id.eq.${c.id}`)
            .order('joined_at', { ascending: true })
            .limit(40)
        : Promise.resolve({ data: [] }),
      departmentIds.length
        ? supabase
            .from('school_tokens')
            .select('*')
            .eq('branch_id', c.branch_id)
            .eq('service_date', serviceDate)
            .in('department_id', departmentIds)
            .eq('status', 'no-show')
            .or(`target_counter_id.is.null,target_counter_id.eq.${c.id}`)
            .order('called_at', { ascending: false })
            .limit(20)
        : Promise.resolve({ data: [] }),
      supabase
        .from('school_tokens')
        .select('*', { count: 'exact', head: true })
        .eq('counter_id', c.id)
        .eq('service_date', serviceDate)
        .eq('status', 'served'),
    ])

  const brief = (d: { id: string; nameEn: string; nameAr: string; prefix: string; color: string }) =>
    ({ id: d.id, nameEn: d.nameEn, nameAr: d.nameAr, prefix: d.prefix, color: d.color })

  // A counter can still be linked to a department that has since been
  // deactivated — the lane must keep its name. The active list won't have it,
  // so fetch just the missing ids (zero extra queries in the normal case).
  const activeById = new Map(activeDepartments.map((d) => [d.id, d]))
  const missingIds = departmentIds.filter((id) => !activeById.has(id))
  const laneRows = new Map<string, ReturnType<typeof brief>>()
  for (const id of departmentIds) {
    const d = activeById.get(id)
    if (d) laneRows.set(id, brief(d))
  }
  if (missingIds.length) {
    const { data: extra } = await supabase
      .from('school_departments')
      .select('id, name_en, name_ar, prefix, color')
      .in('id', missingIds)
    for (const r of (extra ?? []) as
      { id: string; name_en: string; name_ar: string; prefix: string; color: string }[]) {
      laneRows.set(r.id, { id: r.id, nameEn: r.name_en, nameAr: r.name_ar, prefix: r.prefix, color: r.color })
    }
  }

  return {
    branchId: c.branch_id,
    value: {
      status: 'ok',
      counterName: c.name_en,
      counterNameAr: c.name_ar,
      isOpen: c.is_open,
      acceptsPriority: c.accepts_priority,
      serviceDate,
      current: current ? toSchoolTokenDTO(current as DbSchoolToken) : null,
      waiting: ((waiting ?? []) as DbSchoolToken[]).map(toSchoolTokenDTO),
      noShows: ((noShows ?? []) as DbSchoolToken[]).map(toSchoolTokenDTO),
      // Manager's preference order, so the lane reads the way NEXT will behave.
      departments: departmentIds.map((id) => laneRows.get(id)).filter((d) => d !== undefined),
      issuable: activeDepartments.map(brief),
      servedToday: servedToday ?? 0,
    },
  }
}

// ── Provider-owned branding ───────────────────────────────────
// One entry per branch of every school customer asked for, whether or not that
// branch has a school_settings row yet — the distributor panel needs to offer
// the field before the tenant has ever saved settings. Two bulk queries rather
// than one per customer, because /distributor/customers lists them all.
export async function getSchoolBranchIdentities(
  customerIds: string[]
): Promise<Record<string, SchoolBranchIdentity[]>> {
  if (customerIds.length === 0) return {}

  const supabase = createSupabaseServiceClient()
  const { data: branches } = await supabase
    .from('branches')
    .select('id, customer_id, name')
    .in('customer_id', customerIds)
    .order('created_at', { ascending: true })

  const branchRows = (branches ?? []) as { id: string; customer_id: string; name: string }[]
  if (branchRows.length === 0) return {}

  const { data: settings } = await supabase
    .from('school_settings')
    .select('branch_id, school_name_en, school_name_ar, school_name, logo_url')
    .in('branch_id', branchRows.map((b) => b.id))

  const byBranch = new Map(
    ((settings ?? []) as {
      branch_id: string; school_name_en: string; school_name_ar: string
      school_name: unknown; logo_url: string
    }[]).map((r) => [r.branch_id, r])
  )

  const result: Record<string, SchoolBranchIdentity[]> = {}
  for (const branch of branchRows) {
    const row = byBranch.get(branch.id)
    ;(result[branch.customer_id] ??= []).push({
      branchId: branch.id,
      branchName: branch.name,
      customerId: branch.customer_id,
      schoolNameEn: row?.school_name_en ?? '',
      schoolNameAr: row?.school_name_ar ?? '',
      schoolName: toLocaleMap(row?.school_name, row?.school_name_en ?? ''),
      logoUrl: row?.logo_url ?? '',
    })
  }
  return result
}


// ── Scoped devices (manager view) ─────────────────────────────
export const getSchoolScreens = cache(async (branchId: string): Promise<SchoolScreenDTO[]> => {
  const supabase = createSupabaseServiceClient()
  const { data: screens } = await supabase
    .from('screens')
    .select('id, name, screen_token, last_seen_at')
    .eq('branch_id', branchId)
    .eq('kind', 'school')
    .eq('is_active', true)
    .order('created_at', { ascending: true })

  const rows = (screens ?? []) as { id: string; name: string; screen_token: string; last_seen_at: string | null }[]
  if (rows.length === 0) return []

  const ids = rows.map((r) => r.id)
  const [{ data: depts }, { data: counters }] = await Promise.all([
    supabase.from('school_screen_departments').select('screen_id, department_id').in('screen_id', ids),
    supabase.from('school_screen_counters').select('screen_id, counter_id').in('screen_id', ids),
  ])

  const group = <K extends string>(list: unknown, key: K) => {
    const map = new Map<string, string[]>()
    for (const r of (list ?? []) as ({ screen_id: string } & Record<K, string>)[]) {
      map.set(r.screen_id, [...(map.get(r.screen_id) ?? []), r[key]])
    }
    return map
  }
  const byDept = group(depts, 'department_id')
  const byCounter = group(counters, 'counter_id')

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    token: r.screen_token,
    lastSeenAt: r.last_seen_at,
    scope: { departmentIds: byDept.get(r.id) ?? [], counterIds: byCounter.get(r.id) ?? [] },
  }))
})

export const getSchoolKiosks = cache(async (branchId: string): Promise<SchoolKioskDTO[]> => {
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase
    .from('school_kiosks')
    .select('*')
    .eq('branch_id', branchId)
    .eq('is_active', true)
    .order('created_at', { ascending: true })

  const rows = (data ?? []) as DbSchoolKiosk[]
  if (rows.length === 0) return []

  const { data: links } = await supabase
    .from('school_kiosk_departments')
    .select('kiosk_id, department_id')
    .in('kiosk_id', rows.map((r) => r.id))

  const byKiosk = new Map<string, string[]>()
  for (const l of (links ?? []) as { kiosk_id: string; department_id: string }[]) {
    byKiosk.set(l.kiosk_id, [...(byKiosk.get(l.kiosk_id) ?? []), l.department_id])
  }

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    token: r.kiosk_token,
    counterId: r.counter_id,
    departmentIds: byKiosk.get(r.id) ?? [],
    lastSeenAt: r.last_seen_at,
  }))
})
