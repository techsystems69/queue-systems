'use client'

import { useState, useActionState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Plus, Copy, ExternalLink, Tv, TabletSmartphone, Smartphone, SlidersHorizontal, Trash2, RefreshCw,
} from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  createSchoolScreenAction, createSchoolKioskAction, createDevicePairingCodeAction,
  setSchoolScreenScopeAction, updateSchoolKioskAction, deactivateSchoolKioskAction,
  deactivateSchoolScreenAction, regenerateSchoolKioskTokenAction,
  type SchoolKioskResult,
} from '@/lib/actions/school-admin'
import { formatRelativeTime } from '@/lib/queueUtils'
import { ProvisioningQrDialog } from '@/components/devices/ProvisioningQrDialog'
import { DevicePairingDialog } from '@/components/devices/DevicePairingDialog'
import { ScopePicker, describeScope } from '@/components/school/ScopePicker'
import type {
  SchoolCounterDTO, SchoolDepartmentDTO, SchoolDeviceScope, SchoolKioskDTO, SchoolScreenDTO,
} from '@/lib/db/school-types'

const SCREEN_INIT: { error?: string; screenToken?: string } = {}
const KIOSK_INIT: SchoolKioskResult = {}
const NO_SCOPE: SchoolDeviceScope = { departmentIds: [], counterIds: [] }

type KioskMode = 'all' | 'departments' | 'counter'

interface Props {
  branchId: string
  branchToken: string
  screens: SchoolScreenDTO[]
  kiosks: SchoolKioskDTO[]
  counters: SchoolCounterDTO[]
  departments: SchoolDepartmentDTO[]
}

export function SchoolScreensManager({
  branchId, branchToken, screens, kiosks, counters, departments,
}: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function copy(url: string, what: string) {
    navigator.clipboard.writeText(url).then(() => toast.success(`${what} link copied`))
  }

  // The lists are server-rendered, so a mutation re-fetches them rather than
  // half-syncing local state.
  function run(fn: () => Promise<{ error?: string }>, success: string) {
    startTransition(async () => {
      const result = await fn()
      if (result.error) toast.error(result.error)
      else {
        toast.success(success)
        router.refresh()
      }
    })
  }

  const counterName = (id: string | null) => counters.find((c) => c.id === id)?.nameEn ?? 'a counter'

  return (
    <div className="space-y-6">
      <MainKiosk branchId={branchId} branchToken={branchToken} copy={copy} />

      {/* ── Extra kiosks: per-department / per-desk ───────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <TabletSmartphone className="size-4 text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-800">Department &amp; desk kiosks</h2>
          </div>
          <AddKioskDialog
            branchId={branchId}
            departments={departments}
            counters={counters}
            onCreated={() => router.refresh()}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          A kiosk for one department, or one dedicated to a single desk — visitors who take a ticket
          there are called by that desk only.
        </p>

        {kiosks.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
            <p className="text-sm font-medium text-slate-700">No department kiosks yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              The main kiosk above offers every department.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {kiosks.map((kiosk) => (
              <li
                key={kiosk.id}
                className="space-y-2.5 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">{kiosk.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {kiosk.counterId
                        ? `Desk kiosk · tickets go to ${counterName(kiosk.counterId)}`
                        : `Offers: ${describeScope({ departmentIds: kiosk.departmentIds, counterIds: [] }, departments, counters).replace('Whole school', 'every department')}`}
                      {' · '}
                      {kiosk.lastSeenAt ? `Last seen ${formatRelativeTime(kiosk.lastSeenAt)}` : 'Never opened'}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm"
                    onClick={() => copy(`${window.location.origin}/school/kiosk/${kiosk.token}`, 'Kiosk')}>
                    <Copy className="size-3.5" />
                    Copy link
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <a href={`/school/kiosk/${kiosk.token}`} target="_blank" rel="noreferrer">
                      <ExternalLink className="size-3.5" />
                      Open
                    </a>
                  </Button>
                  <DevicePairingDialog
                    role="kiosk"
                    branchId={branchId}
                    kioskId={kiosk.id}
                    label={`Pair "${kiosk.name}"`}
                    createCode={createDevicePairingCodeAction}
                  />
                  <ProvisioningQrDialog
                    role="kiosk"
                    token={kiosk.token}
                    label={`Pair "${kiosk.name}"`}
                    vertical="school"
                  />
                  {!kiosk.counterId && (
                    <EditKioskDepartments
                      kiosk={kiosk}
                      departments={departments}
                      pending={pending}
                      onSave={(ids) =>
                        run(() => updateSchoolKioskAction(kiosk.id, branchId, { departmentIds: ids }),
                          'Kiosk updated')}
                    />
                  )}
                  <Button variant="outline" size="sm" disabled={pending}
                    onClick={() => run(async () => {
                      const r = await regenerateSchoolKioskTokenAction(kiosk.id, branchId)
                      return { error: r.error }
                    }, 'New link generated — the old one no longer works')}>
                    <RefreshCw className="size-3.5" />
                    New link
                  </Button>
                  <Button variant="outline" size="sm" disabled={pending}
                    className="ms-auto text-red-600 hover:text-red-700"
                    onClick={() => {
                      if (!window.confirm(`Remove "${kiosk.name}"? Its link stops working immediately.`)) return
                      run(() => deactivateSchoolKioskAction(kiosk.id, branchId), 'Kiosk removed')
                    }}>
                    <Trash2 className="size-3.5" />
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Calling displays ──────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Tv className="size-4 text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-800">Calling displays</h2>
          </div>
          <AddScreenDialog
            branchId={branchId}
            departments={departments}
            counters={counters}
            onCreated={() => router.refresh()}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          A display can show the whole school, or just the departments and counters you pick — it
          then lists only those windows and announces only their calls.
        </p>

        {screens.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <p className="text-sm font-medium text-slate-700">No displays yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Add one, then open its link on the TV browser.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {screens.map((screen) => (
              <li
                key={screen.id}
                className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">{screen.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    Shows: {describeScope(screen.scope, departments, counters)}
                    {' · '}
                    {screen.lastSeenAt ? `Last seen ${formatRelativeTime(screen.lastSeenAt)}` : 'Never opened'}
                  </p>
                </div>
                <Button variant="outline" size="sm"
                  onClick={() => copy(`${window.location.origin}/school/display/${screen.token}`, 'Display')}>
                  <Copy className="size-3.5" />
                  Copy link
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <a href={`/school/display/${screen.token}`} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-3.5" />
                    Open
                  </a>
                </Button>
                <EditScreenScope
                  screen={screen}
                  departments={departments}
                  counters={counters}
                  pending={pending}
                  onSave={(scope) =>
                    run(() => setSchoolScreenScopeAction(screen.id, branchId, scope), 'Display updated')}
                />
                <DevicePairingDialog
                  role="display"
                  branchId={branchId}
                  screenId={screen.id}
                  label={`Pair "${screen.name}"`}
                  createCode={createDevicePairingCodeAction}
                />
                <ProvisioningQrDialog
                  role="display"
                  token={screen.token}
                  label={`Pair "${screen.name}"`}
                  vertical="school"
                />
                <Button variant="outline" size="sm" disabled={pending}
                  className="text-red-600 hover:text-red-700"
                  onClick={() => {
                    if (!window.confirm(`Remove "${screen.name}"? Its link stops working immediately.`)) return
                    run(() => deactivateSchoolScreenAction(screen.id, branchId), 'Display removed')
                  }}>
                  <Trash2 className="size-3.5" />
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

// The branch-token kiosk: one per branch, offers every department.
function MainKiosk({ branchId, branchToken, copy }: {
  branchId: string
  branchToken: string
  copy: (url: string, what: string) => void
}) {
  const kioskUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/school/kiosk/${branchToken}`
    : ''

  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2.5">
        <TabletSmartphone className="size-4 text-slate-500" />
        <h2 className="text-sm font-semibold text-slate-800">Main ticket kiosk</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Open this on the kiosk terminal in the lobby. It shows one button per department and
        prints a ticket.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => copy(kioskUrl, 'Kiosk')}>
          <Copy className="size-3.5" />
          Copy link
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a href={`/school/kiosk/${branchToken}`} target="_blank" rel="noreferrer">
            <ExternalLink className="size-3.5" />
            Open
          </a>
        </Button>
      </div>

      {/* The native Android kiosk app is provisioned with the raw token, not
          a URL — its setup screen asks for exactly this string. */}
      <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center gap-2">
          <Smartphone className="size-3.5 text-slate-500" />
          <p className="text-xs font-semibold text-slate-700">Kiosk app token</p>
        </div>
        <p className="text-xs text-muted-foreground">
          Installing the VibeQueue Kiosk Android app on the tablet? Open its setup wizard and
          type a pairing code — no need to enter this long token by hand.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <DevicePairingDialog
            role="kiosk"
            branchId={branchId}
            label="Pair the kiosk app"
            createCode={createDevicePairingCodeAction}
          />
          <ProvisioningQrDialog
            role="kiosk"
            token={branchToken}
            label="Pair the kiosk app"
            vertical="school"
          />
        </div>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">Show the raw token</summary>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-800">
              {branchToken}
            </code>
            <Button variant="outline" size="sm" onClick={() => copy(branchToken, 'Kiosk app token')}>
              <Copy className="size-3.5" />
              Copy
            </Button>
          </div>
        </details>
      </div>
    </section>
  )
}

function AddKioskDialog({ branchId, departments, counters, onCreated }: {
  branchId: string
  departments: SchoolDepartmentDTO[]
  counters: SchoolCounterDTO[]
  onCreated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<KioskMode>('departments')
  const [scope, setScope] = useState<SchoolDeviceScope>(NO_SCOPE)
  const [counterId, setCounterId] = useState('')
  const [state, action, pending] = useActionState(createSchoolKioskAction, KIOSK_INIT)
  const [seen, setSeen] = useState<string | null>(null)

  if (state.kioskToken && state.kioskToken !== seen) {
    setSeen(state.kioskToken)
    setOpen(false)
    setScope(NO_SCOPE)
    setCounterId('')
  }
  // Side effects stay out of render; keyed on the new token so it fires once.
  useEffect(() => {
    if (!seen) return
    toast.success('Kiosk added')
    onCreated()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen])

  const activeCounters = counters.filter((c) => c.isActive)
  const modes: { id: KioskMode; label: string; hint: string }[] = [
    { id: 'departments', label: 'Some departments', hint: 'Only the departments you tick' },
    { id: 'counter', label: 'One desk', hint: "That desk's departments; only it calls the ticket" },
    { id: 'all', label: 'Everything', hint: 'A second, separately revocable main kiosk' },
  ]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="bg-accent-600 hover:bg-accent-700 text-white">
          <Plus className="size-4" />
          Add Kiosk
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Kiosk</DialogTitle>
        </DialogHeader>
        <form action={action} className="space-y-4">
          <input type="hidden" name="branchId" value={branchId} />
          <input type="hidden" name="mode" value={mode} />
          <div className="space-y-1.5">
            <Label htmlFor="kiosk-name">Kiosk name</Label>
            <Input id="kiosk-name" name="name" required maxLength={100} placeholder="Admissions wing kiosk" />
          </div>

          <div className="space-y-1.5">
            <Label>This kiosk is for</Label>
            <div className="grid gap-1.5">
              {modes.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={mode === m.id}
                  onClick={() => setMode(m.id)}
                  className={
                    mode === m.id
                      ? 'rounded-xl border-2 border-accent-400 bg-accent-50 px-3 py-2 text-start'
                      : 'rounded-xl border border-slate-200 bg-white px-3 py-2 text-start active:bg-slate-50'
                  }
                >
                  <p className="text-sm font-medium text-slate-800">{m.label}</p>
                  <p className="text-[11px] text-muted-foreground">{m.hint}</p>
                </button>
              ))}
            </div>
          </div>

          {mode === 'departments' && (
            <ScopePicker
              departments={departments}
              value={scope}
              onChange={setScope}
              emitFormFields
            />
          )}

          {mode === 'counter' && (
            <div className="space-y-1.5">
              <Label htmlFor="kiosk-counter">Desk</Label>
              <select
                id="kiosk-counter"
                name="counterId"
                value={counterId}
                onChange={(e) => setCounterId(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="">Choose a counter…</option>
                {activeCounters.map((c) => (
                  <option key={c.id} value={c.id}>{c.nameEn}</option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">
                The kiosk offers whatever departments that counter serves. Assign them on the
                Counters page.
              </p>
            </div>
          )}

          {state.error && <p className="text-sm text-red-600">{state.error}</p>}
          <Button type="submit" disabled={pending}
            className="w-full bg-accent-600 hover:bg-accent-700 text-white">
            {pending ? 'Adding…' : 'Add Kiosk'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AddScreenDialog({ branchId, departments, counters, onCreated }: {
  branchId: string
  departments: SchoolDepartmentDTO[]
  counters: SchoolCounterDTO[]
  onCreated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [scoped, setScoped] = useState(false)
  const [scope, setScope] = useState<SchoolDeviceScope>(NO_SCOPE)
  const [state, action, pending] = useActionState(createSchoolScreenAction, SCREEN_INIT)
  const [seen, setSeen] = useState<string | null>(null)

  if (state.screenToken && state.screenToken !== seen) {
    setSeen(state.screenToken)
    setOpen(false)
    setScoped(false)
    setScope(NO_SCOPE)
  }
  useEffect(() => {
    if (!seen) return
    toast.success('Display added')
    onCreated()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="bg-accent-600 hover:bg-accent-700 text-white">
          <Plus className="size-4" />
          Add Display
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Calling Display</DialogTitle>
        </DialogHeader>
        <form action={action} className="space-y-4">
          <input type="hidden" name="branchId" value={branchId} />
          <div className="space-y-1.5">
            <Label htmlFor="screen-name">Screen name</Label>
            <Input id="screen-name" name="name" required maxLength={100} placeholder="Admissions wing TV" />
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {([
              [false, 'Whole school', 'Every counter'],
              [true, 'Only some', 'Pick departments / counters'],
            ] as const).map(([value, label, hint]) => (
              <button
                key={label}
                type="button"
                aria-pressed={scoped === value}
                onClick={() => setScoped(value)}
                className={
                  scoped === value
                    ? 'rounded-xl border-2 border-accent-400 bg-accent-50 px-3 py-2 text-start'
                    : 'rounded-xl border border-slate-200 bg-white px-3 py-2 text-start active:bg-slate-50'
                }
              >
                <p className="text-sm font-medium text-slate-800">{label}</p>
                <p className="text-[11px] text-muted-foreground">{hint}</p>
              </button>
            ))}
          </div>

          {scoped && (
            <ScopePicker
              departments={departments}
              counters={counters}
              value={scope}
              onChange={setScope}
              emitFormFields
            />
          )}

          {state.error && <p className="text-sm text-red-600">{state.error}</p>}
          <Button type="submit" disabled={pending || (scoped && scope.departmentIds.length + scope.counterIds.length === 0)}
            className="w-full bg-accent-600 hover:bg-accent-700 text-white">
            {pending ? 'Adding…' : 'Add Display'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EditScreenScope({ screen, departments, counters, pending, onSave }: {
  screen: SchoolScreenDTO
  departments: SchoolDepartmentDTO[]
  counters: SchoolCounterDTO[]
  pending: boolean
  onSave: (scope: SchoolDeviceScope) => void
}) {
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState(screen.scope)

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) setScope(screen.scope) }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <SlidersHorizontal className="size-3.5" />
          What it shows
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{screen.name} — what it shows</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Leave everything unticked to show the whole school.
        </p>
        <ScopePicker departments={departments} counters={counters} value={scope} onChange={setScope} />
        <Button disabled={pending}
          onClick={() => { onSave(scope); setOpen(false) }}
          className="w-full bg-accent-600 hover:bg-accent-700 text-white">
          Save
        </Button>
      </DialogContent>
    </Dialog>
  )
}

function EditKioskDepartments({ kiosk, departments, pending, onSave }: {
  kiosk: SchoolKioskDTO
  departments: SchoolDepartmentDTO[]
  pending: boolean
  onSave: (departmentIds: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<SchoolDeviceScope>({ departmentIds: kiosk.departmentIds, counterIds: [] })

  return (
    <Dialog open={open} onOpenChange={(v) => {
      setOpen(v)
      if (v) setScope({ departmentIds: kiosk.departmentIds, counterIds: [] })
    }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <SlidersHorizontal className="size-3.5" />
          Departments
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{kiosk.name} — departments</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Leave everything unticked to offer every department.
        </p>
        <ScopePicker departments={departments} value={scope} onChange={setScope} />
        <Button disabled={pending}
          onClick={() => { onSave(scope.departmentIds); setOpen(false) }}
          className="w-full bg-accent-600 hover:bg-accent-700 text-white">
          Save
        </Button>
      </DialogContent>
    </Dialog>
  )
}
