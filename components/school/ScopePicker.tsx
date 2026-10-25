'use client'

import type { SchoolCounterDTO, SchoolDepartmentDTO, SchoolDeviceScope } from '@/lib/db/school-types'

// Pick which slice of the branch a device covers. Works inside a native <form>
// (it emits `scopeDepartmentIds` / `scopeCounterIds` hidden inputs) and as a
// controlled picker for dialogs that submit through an action call.

interface Props {
  departments: SchoolDepartmentDTO[]
  counters?: SchoolCounterDTO[]
  value: SchoolDeviceScope
  onChange: (next: SchoolDeviceScope) => void
  /** Emit hidden inputs so an enclosing <form action> receives the selection. */
  emitFormFields?: boolean
}

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
}

export function ScopePicker({ departments, counters, value, onChange, emitFormFields }: Props) {
  const activeCounters = (counters ?? []).filter((c) => c.isActive)

  return (
    <div className="space-y-3">
      {emitFormFields && (
        <>
          {value.departmentIds.map((id) => (
            <input key={`d${id}`} type="hidden" name="scopeDepartmentIds" value={id} />
          ))}
          {value.counterIds.map((id) => (
            <input key={`c${id}`} type="hidden" name="scopeCounterIds" value={id} />
          ))}
        </>
      )}

      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-slate-700">Departments</p>
        {departments.length === 0 ? (
          <p className="text-xs text-muted-foreground">No departments yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {departments.map((d) => {
              const on = value.departmentIds.includes(d.id)
              return (
                <button
                  key={d.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange({ ...value, departmentIds: toggle(value.departmentIds, d.id) })}
                  className={
                    on
                      ? 'flex items-center gap-1.5 rounded-full border-2 border-accent-400 bg-accent-50 px-2.5 py-1 text-xs font-medium text-slate-800'
                      : 'flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 active:bg-slate-50'
                  }
                >
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                  {d.nameEn}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {counters && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-slate-700">Counters</p>
          {activeCounters.length === 0 ? (
            <p className="text-xs text-muted-foreground">No counters yet.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {activeCounters.map((c) => {
                const on = value.counterIds.includes(c.id)
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onChange({ ...value, counterIds: toggle(value.counterIds, c.id) })}
                    className={
                      on
                        ? 'rounded-full border-2 border-accent-400 bg-accent-50 px-2.5 py-1 text-xs font-medium text-slate-800'
                        : 'rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 active:bg-slate-50'
                    }
                  >
                    {c.nameEn}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** "Admissions, Fees · Counter 2", or "Whole school" for an unscoped device. */
export function describeScope(
  scope: SchoolDeviceScope,
  departments: SchoolDepartmentDTO[],
  counters: SchoolCounterDTO[]
): string {
  const names = [
    ...scope.departmentIds.map((id) => departments.find((d) => d.id === id)?.nameEn),
    ...scope.counterIds.map((id) => counters.find((c) => c.id === id)?.nameEn),
  ].filter((n): n is string => !!n)
  return names.length > 0 ? names.join(', ') : 'Whole school'
}
