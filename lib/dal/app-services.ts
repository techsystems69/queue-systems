import 'server-only'
import { createSupabaseServiceClient } from '@/lib/db/server'
import type { CustomerVertical } from '@/lib/db/types'

// The service catalog: what a signed-in operator can turn a device into.
//
// This is the source of truth for the native app's "choose a service" screen, so
// a new thing a hotel can put on a screen is added HERE (one entry) and shows up
// on every installed device on the next sign-in — no APK release. The app renders
// any entry it doesn't have a native screen for as a full-screen web view of
// `path` (the token-authenticated staff pages already exist on the web), and
// simply skips a `kind` it has never heard of.
//
// Two native kinds have real screens: `kiosk` (branch token) and `display`
// (screen token). Everything else is `web`.

export type AppServiceKind = 'kiosk' | 'display' | 'web'

export interface AppService {
  /** Stable across sign-ins — the app may remember it. */
  id: string
  kind: AppServiceKind
  /** `customer` = faces guests (kiosk, boards); `staff` = a working console. */
  group: 'customer' | 'staff'
  branchId: string
  title: string
  description: string
  /** A key the app maps to an icon; an unknown key renders a generic one. */
  icon: string
  /** kiosk: the branch token. display: the screen token. web: ''. */
  token: string
  /** web only: a server-relative path (e.g. `/counter/<token>`). Else ''. */
  path: string
}

interface BranchRef {
  id: string
  name: string
  branchToken: string
}

interface ScreenRef {
  id: string
  name: string
  kind: string
  branchId: string
  screenToken: string
}

const KIOSK_COPY: Record<CustomerVertical, string> = {
  business: 'Guests enter their bill number and get a queue number.',
  school: 'Visitors pick a department and get a printed token.',
  hospital: 'Patients pick a department or doctor and get a token.',
}

// screens.kind values per product (the business product's kind is 'queue').
const DISPLAY_KIND: Record<CustomerVertical, string> = {
  business: 'queue',
  school: 'school',
  hospital: 'hospital',
}

const BUSINESS_COUNTER_COPY: Record<string, { description: string; icon: string }> = {
  order: { description: 'Take orders and issue bill numbers.', icon: 'receipt' },
  billing: { description: 'Bill orders and hand them on.', icon: 'payments' },
  kitchen: { description: 'Kitchen display for the prep queue.', icon: 'kitchen' },
  delivery: { description: 'Hand finished orders to guests.', icon: 'delivery' },
  call: { description: 'Call numbers up to the counter.', icon: 'campaign' },
}

export function displayService(s: {
  id: string
  name: string
  branchId: string
  screenToken: string
}): AppService {
  return {
    id: `display:${s.id}`,
    kind: 'display',
    group: 'customer',
    branchId: s.branchId,
    title: s.name,
    description: 'Announcement display — shows and announces called numbers.',
    icon: 'display',
    token: s.screenToken,
    path: '',
  }
}

/** The `screens.kind` a display of this product is stored under. */
export function displayKindFor(vertical: CustomerVertical): string {
  return DISPLAY_KIND[vertical]
}

export async function buildAppServices(
  vertical: CustomerVertical,
  customerId: string,
  branches: BranchRef[],
  screens: ScreenRef[]
): Promise<AppService[]> {
  const services: AppService[] = []

  for (const b of branches) {
    services.push({
      id: `kiosk:${b.id}`,
      kind: 'kiosk',
      group: 'customer',
      branchId: b.id,
      title: 'Ticket kiosk',
      description: KIOSK_COPY[vertical],
      icon: 'kiosk',
      token: b.branchToken,
      path: '',
    })
  }

  for (const s of screens) {
    if (s.kind === DISPLAY_KIND[vertical]) services.push(displayService(s))
  }

  services.push(...(await loadConsoles(vertical, customerId, branches.map((b) => b.id))))
  return services
}

// Staff consoles. Best-effort: a failed read drops the consoles, never the
// kiosk/display entries above it — sign-in must not break over an optional list.
async function loadConsoles(
  vertical: CustomerVertical,
  customerId: string,
  branchIds: string[]
): Promise<AppService[]> {
  if (branchIds.length === 0) return []
  const supabase = createSupabaseServiceClient()

  try {
    if (vertical === 'business') {
      const { data } = await supabase
        .from('counters')
        .select('id, branch_id, name, type, counter_token')
        .eq('customer_id', customerId)
        .in('branch_id', branchIds)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
      return ((data ?? []) as Array<{
        id: string
        branch_id: string
        name: string
        type: string
        counter_token: string
      }>).map((c) => {
        const copy = BUSINESS_COUNTER_COPY[c.type]
        return {
          id: `counter:${c.id}`,
          kind: 'web' as const,
          group: 'staff' as const,
          branchId: c.branch_id,
          title: c.name,
          description: copy?.description ?? 'Staff counter console.',
          icon: copy?.icon ?? 'counter',
          token: '',
          path: `/counter/${c.counter_token}`,
        }
      })
    }

    if (vertical === 'school') {
      const { data } = await supabase
        .from('school_counters')
        .select('id, branch_id, name_en, counter_token')
        .eq('customer_id', customerId)
        .in('branch_id', branchIds)
        .eq('is_active', true)
        .order('display_order', { ascending: true })
      return ((data ?? []) as Array<{
        id: string
        branch_id: string
        name_en: string
        counter_token: string
      }>).map((c) => ({
        id: `counter:${c.id}`,
        kind: 'web' as const,
        group: 'staff' as const,
        branchId: c.branch_id,
        title: c.name_en,
        description: 'Call and serve visitors at this window.',
        icon: 'counter',
        token: '',
        path: `/school/counter/${c.counter_token}`,
      }))
    }

    const { data } = await supabase
      .from('hospital_rooms')
      .select('id, branch_id, label, room_token')
      .eq('customer_id', customerId)
      .in('branch_id', branchIds)
      .eq('is_active', true)
      .order('display_order', { ascending: true })
    return ((data ?? []) as Array<{
      id: string
      branch_id: string
      label: string
      room_token: string
    }>).map((r) => ({
      id: `room:${r.id}`,
      kind: 'web' as const,
      group: 'staff' as const,
      branchId: r.branch_id,
      title: r.label,
      description: 'Consultation room console.',
      icon: 'room',
      token: '',
      path: `/hospital/room/${r.room_token}`,
    }))
  } catch {
    return []
  }
}
