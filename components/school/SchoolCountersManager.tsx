'use client'

import { useState, useActionState, useTransition } from 'react'
import { toast } from 'sonner'
import { Plus, Copy, ExternalLink, RefreshCw, Power, SlidersHorizontal } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  createSchoolCounterAction,
  updateSchoolCounterAction,
  regenerateSchoolCounterTokenAction,
  setSchoolCounterDepartmentsAction,
  type SchoolCounterResult,
} from '@/lib/actions/school-admin'
import type { SchoolCounterDTO, SchoolDepartmentDTO, SchoolQuota } from '@/lib/db/school-types'
import { dirFor, LOCALE_LABEL, regionLocales } from '@/lib/region'

const INIT: SchoolCounterResult = {}

interface Props {
  branchId: string
  initialCounters: SchoolCounterDTO[]
  departments: SchoolDepartmentDTO[]
  // How many counters this branch may run, set by the provider. The server
  // enforces it; this only keeps the UI honest about it.
  quota: SchoolQuota
  // Scoped displays / desk kiosks that cover each counter, by counter id.
  devices?: Record<string, { displays: number; kiosks: number }>
}

export function SchoolCountersManager({ branchId, initialCounters, departments, quota, devices = {} }: Props) {
  const [counters, setCounters] = useState(initialCounters)
  // Derived from state so activating and deactivating updates the allowance
  // without a reload.
  const used = counters.filter((c) => c.isActive).length
  const full = used >= quota.limit
  const [open, setOpen] = useState(false)
  const [assigning, setAssigning] = useState<SchoolCounterDTO | null>(null)
  const [createState, createAction, creating] = useActionState(createSchoolCounterAction, INIT)
  const [pending, startTransition] = useTransition()

  if (createState.counter && counters.every((c) => c.id !== createState.counter!.id)) {
    setCounters((prev) => [...prev, { ...createState.counter!, departmentIds: [] }])
    setOpen(false)
  }

  function copyUrl(token: string) {
    const url = `${window.location.origin}/school/counter/${token}`
    navigator.clipboard.writeText(url).then(() => toast.success('Counter link copied'))
  }

  function patch(counter: SchoolCounterDTO, changes: Parameters<typeof updateSchoolCounterAction>[2]) {
    startTransition(async () => {
      const result = await updateSchoolCounterAction(counter.id, branchId, changes)
      if (result.error) toast.error(result.error)
      else {
        setCounters((prev) =>
          prev.map((c) => (c.id === counter.id ? { ...result.counter!, departmentIds: c.departmentIds } : c))
        )
      }
    })
  }

  function regenerate(counter: SchoolCounterDTO) {
    startTransition(async () => {
      const result = await regenerateSchoolCounterTokenAction(counter.id, branchId)
      if (result.error) toast.error(result.error)
      else {
        setCounters((prev) =>
          prev.map((c) => (c.id === counter.id ? { ...result.counter!, departmentIds: c.departmentIds } : c))
        )
        toast.success('New link generated — the old one no longer works')
      }
    })
  }

  function saveAssignment(counter: SchoolCounterDTO, departmentIds: string[]) {
    startTransition(async () => {
      const result = await setSchoolCounterDepartmentsAction(counter.id, branchId, departmentIds)
      if (result.error) toast.error(result.error)
      else {
        setCounters((prev) => prev.map((c) => (c.id === counter.id ? { ...c, departmentIds } : c)))
        setAssigning(null)
        toast.success('Departments saved')
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-accent-600 hover:bg-accent-700 text-white" disabled={full}>
              <Plus className="size-4" />
              Add Counter
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Counter</DialogTitle>
            </DialogHeader>
            <form action={createAction} className="space-y-4">
              <input type="hidden" name="branchId" value={branchId} />
              <div className="space-y-1.5">
                <Label htmlFor="name_en">Counter name</Label>
                <Input id="name_en" name="name_en" required maxLength={100} placeholder="Counter 1" />
                <p className="text-[11px] text-muted-foreground">
                  This is what the TV shows visitors, so name it the way the window is signed.
                </p>
              </div>
              {regionLocales().slice(1).map((l) => (
                <div key={l} className="space-y-1.5">
                  <Label htmlFor={`name_${l}`}>Counter name ({LOCALE_LABEL[l]})</Label>
                  <Input id={`name_${l}`} name={`name_${l}`} maxLength={100} dir={dirFor(l)} />
                </div>
              ))}
              <div className="space-y-1.5">
                <Label htmlFor="keypadCode">Hardware keypad code</Label>
                <Input id="keypadCode" name="keypadCode" maxLength={8} inputMode="numeric" placeholder="Optional" />
                <p className="text-[11px] text-muted-foreground">
                  Only needed for a networked calling keypad. Leave blank for USB keypads and the
                  on-screen one.
                </p>
              </div>
              {createState.error && <p className="text-sm text-red-600">{createState.error}</p>}
              <Button
                type="submit"
                disabled={creating}
                className="w-full bg-accent-600 hover:bg-accent-700 text-white"
              >
                {creating ? 'Adding…' : 'Add Counter'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
        <span className="ms-auto text-xs text-muted-foreground tabular-nums">
          {used} of {quota.limit} used
        </span>
      </div>

      {full && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {quota.limit === 0
            ? 'No counters are included in your plan. Ask your provider to assign some.'
            : `You're using all ${quota.limit} counter${quota.limit === 1 ? '' : 's'} included in your plan. ` +
              'Ask your provider to assign more, or deactivate one you no longer use.'}
        </p>
      )}

      {counters.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-sm font-medium text-slate-700">No counters yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Add one per service window. The TV shows a row for each.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {counters.map((counter) => {
            const assigned = departments.filter((d) => counter.departmentIds?.includes(d.id))
            return (
              <li
                key={counter.id}
                className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm space-y-3"
              >
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">{counter.nameEn}</p>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">{counter.token}</p>
                  </div>
                  <span
                    className={
                      counter.isActive
                        ? 'rounded-full border border-accent-200 bg-accent-50 px-2 py-0.5 text-[11px] font-medium text-accent-700'
                        : 'rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500'
                    }
                  >
                    {counter.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {assigned.length === 0 ? (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                      No departments assigned — this counter can&apos;t call anyone
                    </span>
                  ) : (
                    assigned.map((d, i) => (
                      <span
                        key={d.id}
                        className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600"
                      >
                        {i === 0 ? '1st · ' : ''}{d.nameEn}
                      </span>
                    ))
                  )}
                </div>

                <p className="text-[11px] text-muted-foreground">
                  {(() => {
                    const d = devices[counter.id] ?? { displays: 0, kiosks: 0 }
                    const part = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`
                    return d.displays + d.kiosks === 0
                      ? 'No display or kiosk of its own — it shows on the main ones. Manage under Devices.'
                      : `Own ${part(d.displays, 'calling display')} · ${part(d.kiosks, 'ticket kiosk')}`
                  })()}
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setAssigning(counter)}>
                    <SlidersHorizontal className="size-3.5" />
                    Departments
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => copyUrl(counter.token)}>
                    <Copy className="size-3.5" />
                    Copy link
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <a href={`/school/counter/${counter.token}`} target="_blank" rel="noreferrer">
                      <ExternalLink className="size-3.5" />
                      Open
                    </a>
                  </Button>
                  <Button variant="outline" size="sm" disabled={pending} onClick={() => regenerate(counter)}>
                    <RefreshCw className="size-3.5" />
                    New link
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending || (full && !counter.isActive)}
                    onClick={() => patch(counter, { isActive: !counter.isActive, isOpen: false })}
                  >
                    <Power className="size-3.5" />
                    {counter.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                  <label className="ms-auto flex items-center gap-2 text-xs text-slate-600">
                    Takes priority tokens
                    <Switch
                      checked={counter.acceptsPriority}
                      disabled={pending}
                      onCheckedChange={(v) => patch(counter, { acceptsPriority: v })}
                    />
                  </label>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <AssignDialog
        counter={assigning}
        departments={departments}
        pending={pending}
        onClose={() => setAssigning(null)}
        onSave={saveAssignment}
      />
    </div>
  )
}

// Order matters: the first department listed is the one this window serves
// first when tokens are waiting in several. It's a preference, not a hard
// rule — someone waiting much longer elsewhere still gets called.
function AssignDialog({ counter, departments, pending, onClose, onSave }: {
  counter: SchoolCounterDTO | null
  departments: SchoolDepartmentDTO[]
  pending: boolean
  onClose: () => void
  onSave: (counter: SchoolCounterDTO, ids: string[]) => void
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [forId, setForId] = useState<string | null>(null)

  if (counter && forId !== counter.id) {
    setForId(counter.id)
    setSelected(counter.departmentIds ?? [])
  }

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  return (
    <Dialog open={!!counter} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{counter?.nameEn} — departments</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Tick every department this window serves. The first one you tick is served first
          when several are waiting.
        </p>
        <ul className="space-y-1.5 max-h-72 overflow-y-auto">
          {departments.map((d) => {
            const index = selected.indexOf(d.id)
            return (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => toggle(d.id)}
                  className={
                    index >= 0
                      ? 'flex w-full items-center gap-3 rounded-xl border-2 border-accent-400 bg-accent-50 px-3 py-2.5 text-start'
                      : 'flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-start active:bg-slate-50'
                  }
                >
                  <span
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-black text-white"
                    style={{ backgroundColor: d.color }}
                    dir="ltr"
                  >
                    {d.prefix}
                  </span>
                  <span className="flex-1 truncate text-sm font-medium text-slate-800">{d.nameEn}</span>
                  {index >= 0 && (
                    <span className="text-xs font-semibold text-accent-700 tabular-nums">
                      {index + 1}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
        <Button
          disabled={pending}
          onClick={() => counter && onSave(counter, selected)}
          className="w-full bg-accent-600 hover:bg-accent-700 text-white"
        >
          Save Departments
        </Button>
      </DialogContent>
    </Dialog>
  )
}
