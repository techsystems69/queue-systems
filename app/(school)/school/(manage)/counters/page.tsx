import { requireSchoolContext } from '@/lib/dal/school-context'
import {
  getSchoolCounters, getSchoolDepartments, getSchoolKiosks, getSchoolScreens,
} from '@/lib/dal/school'
import { getSchoolCounterQuota } from '@/lib/dal/school-limits'
import { SchoolCountersManager } from '@/components/school/SchoolCountersManager'

export const dynamic = 'force-dynamic'

export default async function SchoolCountersPage() {
  const { branch, profile } = await requireSchoolContext()
  const [counters, departments, quota, screens, kiosks] = await Promise.all([
    getSchoolCounters(branch.id),
    getSchoolDepartments(branch.id, { activeOnly: true }),
    getSchoolCounterQuota(profile.customerId, branch.id),
    getSchoolScreens(branch.id),
    getSchoolKiosks(branch.id),
  ])

  // Which displays and kiosks cover each counter, so the manager can see at a
  // glance whether a window has its own. A display covers a counter either by
  // naming it or by naming a department the counter serves; a screen with no
  // scope covers all of them and isn't counted as "its own".
  const devices: Record<string, { displays: number; kiosks: number }> = {}
  for (const counter of counters) {
    const served = counter.departmentIds ?? []
    devices[counter.id] = {
      displays: screens.filter(
        (s) =>
          s.scope.counterIds.includes(counter.id) ||
          s.scope.departmentIds.some((id) => served.includes(id))
      ).length,
      kiosks: kiosks.filter((k) => k.counterId === counter.id).length,
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Counters</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Each counter gets its own link. Open it on the operator&apos;s PC — that page is the
          calling keypad.
        </p>
      </div>
      <SchoolCountersManager
        branchId={branch.id}
        initialCounters={counters}
        departments={departments}
        quota={quota}
        devices={devices}
      />
    </div>
  )
}
