// The two products this platform sells, in one place.
//
// Deliberately free of `server-only` and of any Supabase import: the
// distributor forms, the sidebars and the server-side guards all need these
// labels, and a server-only module would drag the service-role client into the
// browser bundle (same reason lib/school/constants.ts exists).
//
// The stored value for the hotel/restaurant product is 'business' — it is the
// column default on customers.vertical and predates the school product. Only
// the label is hotel-facing, so renaming the value is never needed to change
// what a distributor reads on screen.
import type { CustomerVertical } from '@/lib/db/types'

export interface VerticalMeta {
  value: CustomerVertical
  /** Full product name, for distributor forms and onboarding. */
  label: string
  /** Space-constrained name, for table cells and badges. */
  short: string
  description: string
}

export const VERTICALS: VerticalMeta[] = [
  {
    value: 'business',
    label: 'Hotel Queue System',
    short: 'Hotel',
    description: 'Counters, kitchen and delivery flow with bill numbers',
  },
  {
    value: 'school',
    label: 'School Queue System',
    short: 'School',
    description: 'Department tokens, calling windows and a campus board',
  },
  {
    value: 'hospital',
    label: 'Hospital Queue System',
    short: 'Hospital',
    description: 'Per-doctor OPD queues, triage, lab/pharmacy flow and a vernacular voice board',
  },
]

// What the distributor panel offers for new customers and license keys.
// Hospital is hidden for now: derived from VERTICALS rather than removed from
// it, so existing hospital tenants still resolve labels and routing. Put
// 'hospital' back in the list below to sell it again.
const UNSOLD_VERTICALS: CustomerVertical[] = [
  'hospital',
]
export const DISTRIBUTOR_VERTICALS: VerticalMeta[] = VERTICALS.filter(
  (v) => !UNSOLD_VERTICALS.includes(v.value)
)

export function isSellableVertical(value: unknown): value is CustomerVertical {
  return DISTRIBUTOR_VERTICALS.some((v) => v.value === value)
}

export const DEFAULT_VERTICAL: CustomerVertical = 'business'

export function isVertical(value: unknown): value is CustomerVertical {
  return VERTICALS.some((v) => v.value === value)
}

/** Falls back rather than throwing — a bad value must not blank a table cell. */
export function verticalMeta(value: string | null | undefined): VerticalMeta {
  return VERTICALS.find((v) => v.value === value) ?? VERTICALS[0]
}

export function verticalLabel(value: string | null | undefined): string {
  return verticalMeta(value).label
}

/**
 * Where a signed-in user belongs. The single definition behind every
 * post-login redirect and every cross-product guard, so the two can never
 * disagree and bounce a user between them forever.
 */
export function verticalHome(
  vertical: string | null | undefined,
  role?: string | null
): string {
  if (vertical === 'school') return '/school/dashboard'
  if (vertical === 'hospital') return '/hospital/dashboard'
  return role === 'branch_user' ? '/branch' : '/dashboard'
}
