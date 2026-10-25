import { requireSchoolContext } from '@/lib/dal/school-context'
import {
  getSchoolCounters, getSchoolDepartments, getSchoolKiosks, getSchoolScreens,
} from '@/lib/dal/school'
import { SchoolScreensManager } from '@/components/school/SchoolScreensManager'

export const dynamic = 'force-dynamic'

export default async function SchoolScreensPage() {
  const { branch } = await requireSchoolContext()

  // Screens are the shared table — reusing it is what gives the school board
  // the ads cascade, the plan quota and presence for free. `kind` is what
  // makes one a school board. Each carries an optional scope (departments /
  // counters); kiosks beyond the branch-token one live in school_kiosks.
  const [screens, kiosks, counters, departments] = await Promise.all([
    getSchoolScreens(branch.id),
    getSchoolKiosks(branch.id),
    getSchoolCounters(branch.id),
    getSchoolDepartments(branch.id, { activeOnly: true }),
  ])

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Devices</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Point each device at its own link once; the link is the login. Give a department or a
          desk its own kiosk and calling display.
        </p>
      </div>
      <SchoolScreensManager
        branchId={branch.id}
        branchToken={branch.branchToken}
        screens={screens}
        kiosks={kiosks}
        counters={counters}
        departments={departments}
      />
    </div>
  )
}
