// School queue system — row types, DTOs and mappers.
//
// Kept in its own file rather than appended to lib/db/types.ts: the school
// product is a separate namespace with its own tables, and the shared file is
// already the single largest source of merge friction. Shared primitives are
// re-exported from there, never redefined.

import type { AnnouncementLang } from '@/lib/db/types'

// ── Primitive types ───────────────────────────────────────────
export type SchoolTokenStatus =
  | 'waiting' | 'called' | 'held' | 'served' | 'no-show' | 'cancelled'

export type SchoolTokenSource = 'kiosk' | 'staff' | 'web' | 'api'

export type SchoolActivityType =
  | 'issued' | 'called' | 'recalled' | 'held' | 'resumed' | 'served'
  | 'no-show' | 'cancelled' | 'transferred' | 'counter-opened' | 'counter-closed'

export type SchoolLanguage = 'en' | 'ar'

// The provider-owned branding for one school branch, as the distributor panel
// edits it. Tenants see it read-only on /school/settings.
export interface SchoolBranchIdentity {
  branchId: string
  branchName: string
  customerId: string
  schoolNameEn: string
  schoolNameAr: string
  logoUrl: string
}

// How much of a branch's provider-assigned department/counter allowance is
// spent. Lives here rather than in lib/dal/school-limits.ts because the
// manager UIs are client components and that module is server-only.
export interface SchoolQuota {
  limit: number
  used: number
  remaining: number
}

// ── DB Row Types (snake_case — exact DB columns) ──────────────
export interface DbSchoolSettings {
  id: string
  customer_id: string
  branch_id: string
  school_name_en: string
  school_name_ar: string
  logo_url: string
  languages: SchoolLanguage[]
  ticket_footer_en: string
  ticket_footer_ar: string
  kiosk_idle_seconds: number
  priority_enabled: boolean
  announce_enabled: boolean
  announce_template_en: string
  announce_template_ar: string
  print_enabled: boolean
  // The school's own switch for the public QR-tracking page. Effective only
  // together with customers.school_public_tracking_enabled (the distributor
  // grant) — see supabase/migrations/20260902_school_public_tracking.sql.
  public_tracking_enabled: boolean
  timezone: string
  day_start_time: string
  created_at: string
  updated_at: string
}

export interface DbSchoolDepartment {
  id: string
  customer_id: string
  branch_id: string
  name_en: string
  name_ar: string
  prefix: string
  number_start: number
  color: string
  icon: string
  is_priority: boolean
  display_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface DbSchoolCounter {
  id: string
  customer_id: string
  branch_id: string
  name_en: string
  name_ar: string
  counter_token: string
  keypad_code: string | null
  keypad_map: Record<string, string>
  accepts_priority: boolean
  display_order: number
  is_active: boolean
  is_open: boolean
  last_seen_at: string | null
  created_at: string
  updated_at: string
}

export interface DbSchoolCounterDepartment {
  id: string
  customer_id: string
  counter_id: string
  department_id: string
  preference: number
  created_at: string
}

export interface DbSchoolToken {
  id: string
  customer_id: string
  branch_id: string
  department_id: string
  counter_id: string | null
  service_date: string
  number: number
  token_code: string
  // Short, non-enumerable handle for the public tracking page/QR — distinct
  // from token_code, which repeats every day and across branches.
  public_code: string
  status: SchoolTokenStatus
  is_priority: boolean
  source: SchoolTokenSource
  transferred_from_department_id: string | null
  notes: string
  joined_at: string
  called_at: string | null
  served_at: string | null
  call_count: number
  recall_count: number
  created_at: string
}

export interface DbSchoolActivityLog {
  id: string
  customer_id: string
  branch_id: string
  token_id: string | null
  counter_id: string | null
  department_id: string | null
  performed_by: string | null
  source: SchoolTokenSource | 'system'
  type: SchoolActivityType
  token_code: string
  message: string
  created_at: string
}

// ── DTO Types (camelCase — what crosses to the client) ─────────
export interface SchoolSettingsDTO {
  id: string
  customerId: string
  branchId: string
  schoolNameEn: string
  schoolNameAr: string
  logoUrl: string
  languages: SchoolLanguage[]
  ticketFooterEn: string
  ticketFooterAr: string
  kioskIdleSeconds: number
  priorityEnabled: boolean
  announceEnabled: boolean
  announceTemplateEn: string
  announceTemplateAr: string
  printEnabled: boolean
  publicTrackingEnabled: boolean
  timezone: string
  dayStartTime: string
}

export interface SchoolDepartmentDTO {
  id: string
  customerId: string
  branchId: string
  nameEn: string
  nameAr: string
  prefix: string
  numberStart: number
  color: string
  icon: string
  isPriority: boolean
  displayOrder: number
  isActive: boolean
  createdAt: string
}

export interface SchoolCounterDTO {
  id: string
  customerId: string
  branchId: string
  nameEn: string
  nameAr: string
  token: string
  keypadCode: string | null
  keypadMap: Record<string, string>
  acceptsPriority: boolean
  displayOrder: number
  isActive: boolean
  isOpen: boolean
  lastSeenAt: string | null
  createdAt: string
  // Joined from school_counter_departments when the caller asks for it.
  departmentIds?: string[]
}

export interface SchoolTokenDTO {
  id: string
  customerId: string
  branchId: string
  departmentId: string
  counterId: string | null
  serviceDate: string
  number: number
  tokenCode: string
  publicCode: string
  status: SchoolTokenStatus
  isPriority: boolean
  source: SchoolTokenSource
  transferredFromDepartmentId: string | null
  notes: string
  joinedAt: string
  calledAt: string | null
  servedAt: string | null
  callCount: number
  recallCount: number
  createdAt: string
}

export interface SchoolActivityLogDTO {
  id: string
  customerId: string
  branchId: string
  tokenId: string | null
  counterId: string | null
  departmentId: string | null
  performedBy: string | null
  source: string
  type: SchoolActivityType
  tokenCode: string
  message: string
  createdAt: string
}

// ── Board packet (from the get_school_board RPC) ──────────────
// One row per open window — the brochure's TOKEN NO. / COUNTER / STATUS
// layout. A window with no current token still appears, showing nothing.
export interface SchoolBoardCounter {
  id: string
  name_en: string
  name_ar: string
  display_order: number
  is_open: boolean
  last_seen_at: string | null
  token_id: string | null
  token_code: string | null
  called_at: string | null
  recall_count: number | null
  is_priority: boolean | null
  department_en: string | null
  department_ar: string | null
  department_color: string | null
}

export interface SchoolBoardRecent {
  token_code: string
  served_at: string
  counter_en: string | null
  counter_ar: string | null
}

export interface SchoolBoardDepartment {
  id: string
  name_en: string
  name_ar: string
  color: string
  display_order: number
  waiting: number
}

// What the lobby kiosk polls: the tail of today's tokens for its recent-ticket
// rail, plus the queue depth each service tile reports.
export interface SchoolKioskFeed {
  status: 'ok' | 'not-found'
  serviceDate?: string
  recent?: SchoolTokenDTO[]
  waitingByDepartment?: Record<string, number>
  waitingTotal?: number
  issuedToday?: number
}

export interface SchoolBoardPacket {
  status: 'ok' | 'expired' | 'not-found'
  screenId?: string
  branchId?: string
  customerId?: string
  serviceDate?: string
  schoolName?: string
  schoolNameAr?: string
  logoUrl?: string
  primaryColor?: string
  announcementLang?: AnnouncementLang
  announceEnabled?: boolean
  announceTemplateEn?: string
  announceTemplateAr?: string
  showClock?: boolean
  tickerText?: string
  counters?: SchoolBoardCounter[]
  recent?: SchoolBoardRecent[]
  departments?: SchoolBoardDepartment[]
  // Raw rows from the shared ads/ticker tables — the RPC json_agg's them
  // whole, so they arrive snake_case and get mapped at the render boundary.
  ads?: {
    id: string
    file_url: string
    file_type: 'image' | 'video'
    duration_seconds: number
    is_active: boolean
    audio_enabled?: boolean
  }[]
  tickers?: { id: string; message: string }[]
}

// ── Dashboard ─────────────────────────────────────────────────
export interface SchoolDepartmentStats {
  departmentId: string
  nameEn: string
  nameAr: string
  color: string
  total: number
  waiting: number
  served: number
  noShow: number
  avgWaitMinutes: number
}

export interface SchoolDashboardStats {
  totalTokens: number
  waiting: number
  called: number
  served: number
  noShow: number
  cancelled: number
  // Actual wait: called_at − joined_at. Deliberately NOT the
  // completed_at − started_at that getDashboardStats uses, which is service
  // duration mislabelled as wait time.
  avgWaitMinutes: number
  byDepartment: SchoolDepartmentStats[]
}

// ── Mapper Functions ───────────────────────────────────────────
export function toSchoolSettingsDTO(row: DbSchoolSettings): SchoolSettingsDTO {
  return {
    id: row.id,
    customerId: row.customer_id,
    branchId: row.branch_id,
    schoolNameEn: row.school_name_en,
    schoolNameAr: row.school_name_ar,
    logoUrl: row.logo_url,
    languages: row.languages ?? ['en'],
    ticketFooterEn: row.ticket_footer_en,
    ticketFooterAr: row.ticket_footer_ar,
    kioskIdleSeconds: row.kiosk_idle_seconds,
    priorityEnabled: row.priority_enabled,
    announceEnabled: row.announce_enabled,
    announceTemplateEn: row.announce_template_en,
    announceTemplateAr: row.announce_template_ar,
    printEnabled: row.print_enabled,
    publicTrackingEnabled: row.public_tracking_enabled,
    timezone: row.timezone,
    dayStartTime: row.day_start_time,
  }
}

export function toSchoolDepartmentDTO(row: DbSchoolDepartment): SchoolDepartmentDTO {
  return {
    id: row.id,
    customerId: row.customer_id,
    branchId: row.branch_id,
    nameEn: row.name_en,
    nameAr: row.name_ar,
    prefix: row.prefix,
    numberStart: row.number_start,
    color: row.color,
    icon: row.icon,
    isPriority: row.is_priority,
    displayOrder: row.display_order,
    isActive: row.is_active,
    createdAt: row.created_at,
  }
}

export function toSchoolCounterDTO(row: DbSchoolCounter): SchoolCounterDTO {
  return {
    id: row.id,
    customerId: row.customer_id,
    branchId: row.branch_id,
    nameEn: row.name_en,
    nameAr: row.name_ar,
    token: row.counter_token,
    keypadCode: row.keypad_code,
    keypadMap: row.keypad_map ?? {},
    acceptsPriority: row.accepts_priority,
    displayOrder: row.display_order,
    isActive: row.is_active,
    isOpen: row.is_open,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
  }
}

export function toSchoolTokenDTO(row: DbSchoolToken): SchoolTokenDTO {
  return {
    id: row.id,
    customerId: row.customer_id,
    branchId: row.branch_id,
    departmentId: row.department_id,
    counterId: row.counter_id,
    serviceDate: row.service_date,
    number: row.number,
    tokenCode: row.token_code,
    publicCode: row.public_code,
    status: row.status,
    isPriority: row.is_priority,
    source: row.source,
    transferredFromDepartmentId: row.transferred_from_department_id,
    notes: row.notes,
    joinedAt: row.joined_at,
    calledAt: row.called_at,
    servedAt: row.served_at,
    callCount: row.call_count,
    recallCount: row.recall_count,
    createdAt: row.created_at,
  }
}

export function toSchoolActivityLogDTO(row: DbSchoolActivityLog): SchoolActivityLogDTO {
  return {
    id: row.id,
    customerId: row.customer_id,
    branchId: row.branch_id,
    tokenId: row.token_id,
    counterId: row.counter_id,
    departmentId: row.department_id,
    performedBy: row.performed_by,
    source: row.source,
    type: row.type,
    tokenCode: row.token_code,
    message: row.message,
    createdAt: row.created_at,
  }
}

// ── Public ticket status (from the get_public_ticket_status RPC) ──────
// What the public tracking page (app/(public)/t/[code]) polls. The RPC
// returns camelCase JSON directly (json_build_object keys), unlike the other
// RPCs here — so this is consumed as-is, no snake_case mapper needed.
export interface PublicTicketStatus {
  status: 'ok' | 'not-found' | 'disabled' | 'expired'
  schoolNameEn?: string
  schoolNameAr?: string
  logoUrl?: string
  languages?: SchoolLanguage[]
  tokenCode?: string
  tokenStatus?: SchoolTokenStatus
  isPriority?: boolean
  joinedAt?: string
  calledAt?: string | null
  departmentNameEn?: string
  departmentNameAr?: string
  counterNameEn?: string | null
  counterNameAr?: string | null
  serviceDate?: string
  // False when this ticket was issued on an earlier service day — the token
  // row may still say 'waiting' if the day rolled over before it was ever
  // called, but that position is stale and the page must say so rather than
  // show a live countdown.
  isToday?: boolean
  waitingAhead?: number
  nowServingCode?: string | null
  etaSeconds?: number
  paceSampleCount?: number
}

// ── Counter console view ──────────────────────────────────────
export interface SchoolCounterView {
  status: 'ok' | 'not-found'
  counterName?: string
  counterNameAr?: string
  isOpen?: boolean
  acceptsPriority?: boolean
  serviceDate?: string
  current?: SchoolTokenDTO | null
  waiting?: SchoolTokenDTO[]
  // Called, nobody came. Kept out of `waiting` so the lane stays a true queue,
  // but surfaced separately: a visitor who missed their call and came back is
  // routine, and without this the console shows no trace of them at all.
  noShows?: SchoolTokenDTO[]
  departments?: { id: string; nameEn: string; nameAr: string; prefix: string; color: string }[]
  // Every active department of the branch — what staff may issue a walk-in
  // token against. Wider than `departments` (which is only what this window
  // serves) because Reception issuing a Fees token is a normal school flow.
  issuable?: { id: string; nameEn: string; nameAr: string; prefix: string; color: string }[]
  servedToday?: number
}
