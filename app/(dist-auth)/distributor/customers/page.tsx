import { requireDistributor } from '@/lib/dal/session'
import { getAllCustomers } from '@/lib/dal/customers'
import { DistributorCustomersManager } from '@/components/distributor/DistributorCustomersManager'
import { createSupabaseServiceClient } from '@/lib/db/server'
import { getSchoolBranchIdentities } from '@/lib/dal/school'
import type { CustomerVertical } from '@/lib/db/types'

export const dynamic = 'force-dynamic'

export default async function DistributorCustomersPage() {
  await requireDistributor()
  const [customers, plansData] = await Promise.all([
    getAllCustomers(),
    (async () => {
      const supabase = createSupabaseServiceClient()
      // select('*') rather than naming the hospital-tier columns: a DB that
      // hasn't had 20260905_hospital_plans applied would otherwise reject the
      // whole query and, with the error dropped, render an empty plan picker.
      const { data, error } = await supabase
        .from('plans')
        .select('*')
        .eq('is_active', true)
        .order('price_monthly')
      if (error) console.error('[distributor/customers] plans query failed', error.code, error.message)
      return (data ?? []).map((p) => ({
        id: p.id as string,
        name: p.name as string,
        vertical: (p.vertical ?? null) as CustomerVertical | null,
        default_department_limit: (p.default_department_limit ?? null) as number | null,
        default_counter_limit: (p.default_counter_limit ?? null) as number | null,
      }))
    })(),
  ])

  // Name and logo are provider-owned now, so the panel edits them here. Only
  // school tenants have them.
  const identities = await getSchoolBranchIdentities(
    customers.filter((c) => c.vertical === 'school').map((c) => c.id)
  )

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Customers</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manage all tenant accounts</p>
      </div>
      <DistributorCustomersManager
        customers={customers}
        plans={plansData}
        identities={identities}
      />
    </div>
  )
}
