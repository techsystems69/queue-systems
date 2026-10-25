'use client'

import { useState, useActionState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  Plus, Sparkles, Accessibility, Power, Pencil, Trash2, ChevronUp, ChevronDown,
  Building2, Landmark, UserPlus, Users, Receipt, CreditCard, Wallet, FileText,
  ClipboardList, GraduationCap, BookOpen, Library, Bus, Car, ConciergeBell,
  ShoppingBag, ShoppingCart, Shirt, HeartHandshake, Stethoscope, Cross, Phone,
  Mail, Calendar, CalendarDays, Home, Info, HelpCircle, Award, BadgeCheck, MonitorSmartphone,
  type LucideIcon,
} from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  createSchoolDepartmentAction,
  editSchoolDepartmentAction,
  updateSchoolDepartmentAction,
  deleteSchoolDepartmentAction,
  reorderSchoolDepartmentsAction,
  seedSchoolDepartmentsAction,
  provisionSchoolDeskAction,
  type SchoolDepartmentResult,
} from '@/lib/actions/school-admin'
import {
  SCHOOL_DEPARTMENT_COLORS, SCHOOL_DEPARTMENT_ICONS,
} from '@/lib/school/constants'
import type { SchoolDepartmentDTO, SchoolQuota } from '@/lib/db/school-types'
import { dirFor, LOCALE_LABEL, regionLocales } from '@/lib/region'

const INIT: SchoolDepartmentResult = {}

// Only the names mobile/kiosk/lib/src/ui/dept_icon.dart can render, so the
// picker can't produce a department that shows a fallback glyph on the tablet.
const ICONS: Record<string, LucideIcon> = {
  Building2, Landmark, UserPlus, Users, Receipt, CreditCard, Wallet, FileText,
  ClipboardList, GraduationCap, BookOpen, Library, Bus, Car, ConciergeBell,
  ShoppingBag, ShoppingCart, Shirt, Accessibility, HeartHandshake, Stethoscope,
  Cross, Phone, Mail, Calendar, CalendarDays, Home, Info, HelpCircle, Award,
  BadgeCheck,
}

function DepartmentIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? Building2
  return <Icon className={className} />
}

interface Props {
  branchId: string
  initialDepartments: SchoolDepartmentDTO[]
  // How many departments this branch may run, set by the provider. The server
  // enforces it; this only keeps the UI honest about it.
  quota: SchoolQuota
}

export function SchoolDepartmentsManager({ branchId, initialDepartments, quota }: Props) {
  const [departments, setDepartments] = useState(initialDepartments)
  // Derived from state rather than the server snapshot so activating and
  // deactivating updates the allowance without a reload.
  const used = departments.filter((d) => d.isActive).length
  const remaining = Math.max(0, quota.limit - used)
  const full = remaining <= 0
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<SchoolDepartmentDTO | null>(null)
  const [deleting, setDeleting] = useState<SchoolDepartmentDTO | null>(null)
  const [desk, setDesk] = useState<SchoolDepartmentDTO | null>(null)
  const [createState, createAction, creating] = useActionState(createSchoolDepartmentAction, INIT)
  const [editState, editAction, saving] = useActionState(editSchoolDepartmentAction, INIT)
  const [lastSaved, setLastSaved] = useState<SchoolDepartmentDTO | null>(null)
  const [pending, startTransition] = useTransition()

  if (createState.department && departments.every((d) => d.id !== createState.department!.id)) {
    setDepartments((prev) => [...prev, createState.department!])
    setOpen(false)
  }

  // useActionState keeps its last result after the dialog closes, so this
  // compares by identity against what has already been folded in rather than
  // re-applying on every render. Same shape as the create branch above — both
  // are this component updating its own state, which is the only render-time
  // set-state React allows.
  if (editState.department && editState.department !== lastSaved) {
    setLastSaved(editState.department)
    setDepartments((prev) => prev.map((d) => (d.id === editState.department!.id ? editState.department! : d)))
    setEditing(null)
  }

  function handleSeed() {
    startTransition(async () => {
      const result = await seedSchoolDepartmentsAction(branchId)
      if (result.error) toast.error(result.error)
      else if (result.created === 0) toast.info('All the default departments already exist')
      else {
        toast.success(`Added ${result.created} departments`)
        window.location.reload()
      }
    })
  }

  function provisionDesk(dept: SchoolDepartmentDTO, withDisplay: boolean, withKiosk: boolean) {
    startTransition(async () => {
      const result = await provisionSchoolDeskAction({
        branchId, departmentId: dept.id, withDisplay, withKiosk,
      })
      if (result.error) {
        toast.error(result.error)
        // A partial desk (counter made, display refused by the plan) is real:
        // the counter exists, so close the dialog rather than invite a retry
        // that would create a second one.
        if (result.counterId) setDesk(null)
        return
      }
      setDesk(null)
      toast.success(`${dept.nameEn} desk is ready — find its links under Devices and Counters`)
    })
  }

  function handleToggle(dept: SchoolDepartmentDTO) {
    startTransition(async () => {
      const result = await updateSchoolDepartmentAction(dept.id, branchId, { isActive: !dept.isActive })
      if (result.error) toast.error(result.error)
      else {
        setDepartments((prev) => prev.map((d) => (d.id === dept.id ? result.department! : d)))
        toast.success(`${dept.nameEn} ${dept.isActive ? 'deactivated' : 'activated'}`)
      }
    })
  }

  function handleDelete(dept: SchoolDepartmentDTO) {
    startTransition(async () => {
      const result = await deleteSchoolDepartmentAction(dept.id, branchId)
      if (result.error) {
        // A department that has issued tokens can't be removed; the action says
        // why, and deactivating stays one click away behind the dialog.
        toast.error(result.error)
        setDeleting(null)
        return
      }
      setDepartments((prev) => prev.filter((d) => d.id !== dept.id))
      setDeleting(null)
      toast.success(`${dept.nameEn} deleted`)
    })
  }

  // Position in this list is display_order, which is what the kiosk grid and
  // the TV board sort by — so moving a row is a real edit, not a view setting.
  function handleMove(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= departments.length) return

    const next = [...departments]
    ;[next[index], next[target]] = [next[target], next[index]]
    const previous = departments
    setDepartments(next)

    startTransition(async () => {
      const result = await reorderSchoolDepartmentsAction(branchId, next.map((d) => d.id))
      if (result.error) {
        setDepartments(previous)
        toast.error(result.error)
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
              Add Department
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Department</DialogTitle>
            </DialogHeader>
            <form action={createAction} className="space-y-4">
              <input type="hidden" name="branchId" value={branchId} />
              <DepartmentFields />
              {createState.error && <p className="text-sm text-red-600">{createState.error}</p>}
              <Button
                type="submit"
                disabled={creating}
                className="w-full bg-accent-600 hover:bg-accent-700 text-white"
              >
                {creating ? 'Adding…' : 'Add Department'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>

        {departments.length === 0 && !full && (
          <Button variant="outline" onClick={handleSeed} disabled={pending}>
            <Sparkles className="size-4" />
            {remaining >= 8
              ? 'Load the 8 standard departments'
              : `Load ${remaining} standard department${remaining === 1 ? '' : 's'}`}
          </Button>
        )}
        <span className="ms-auto text-xs text-muted-foreground tabular-nums">
          {used} of {quota.limit} used
        </span>
      </div>

      {full && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {quota.limit === 0
            ? 'No departments are included in your plan. Ask your provider to assign some.'
            : `You're using all ${quota.limit} department${quota.limit === 1 ? '' : 's'} included in your plan. ` +
              'Ask your provider to assign more, or deactivate one you no longer use.'}
        </p>
      )}

      {departments.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-sm font-medium text-slate-700">No departments yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            The kiosk shows one button per department. Load the standard set to start.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {departments.map((dept, index) => (
            <li
              key={dept.id}
              className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
            >
              <div className="flex flex-col">
                <button
                  type="button"
                  aria-label={`Move ${dept.nameEn} up`}
                  disabled={pending || index === 0}
                  onClick={() => handleMove(index, -1)}
                  className="text-slate-400 hover:text-slate-700 disabled:opacity-30"
                >
                  <ChevronUp className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${dept.nameEn} down`}
                  disabled={pending || index === departments.length - 1}
                  onClick={() => handleMove(index, 1)}
                  className="text-slate-400 hover:text-slate-700 disabled:opacity-30"
                >
                  <ChevronDown className="size-4" />
                </button>
              </div>
              <div
                className="flex size-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl font-black text-white tabular-nums"
                style={{ backgroundColor: dept.isActive ? dept.color : '#94A3B8' }}
                dir="ltr"
              >
                <DepartmentIcon name={dept.icon} className="size-3.5" />
                <span className="text-[11px] leading-none">{dept.prefix}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-800">{dept.nameEn}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {regionLocales().slice(1).map((l) =>
                    dept.name?.[l] ? <span key={l} dir={dirFor(l)}>{dept.name[l]} · </span> : null
                  )}
                  Numbers from {dept.numberStart}
                </p>
              </div>
              {dept.isPriority && (
                <span className="flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                  <Accessibility className="size-3" />
                  Priority
                </span>
              )}
              <span
                className={
                  dept.isActive
                    ? 'rounded-full border border-accent-200 bg-accent-50 px-2 py-0.5 text-[11px] font-medium text-accent-700'
                    : 'rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500'
                }
              >
                {dept.isActive ? 'Active' : 'Inactive'}
              </span>
              <Button variant="outline" size="sm" disabled={pending} onClick={() => setEditing(dept)}>
                <Pencil className="size-3.5" />
                Edit
              </Button>
              {dept.isActive && (
                <Button variant="outline" size="sm" disabled={pending} onClick={() => setDesk(dept)}>
                  <MonitorSmartphone className="size-3.5" />
                  Set up desk
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={pending || (full && !dept.isActive)}
                onClick={() => handleToggle(dept)}
              >
                <Power className="size-3.5" />
                {dept.isActive ? 'Deactivate' : 'Activate'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => setDeleting(dept)}
                className="text-red-600 hover:bg-red-50 hover:text-red-700"
              >
                <Trash2 className="size-3.5" />
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}

      <DeskDialog
        branchId={branchId}
        department={desk}
        pending={pending}
        onClose={() => setDesk(null)}
        onProvision={provisionDesk}
      />

      <EditDialog
        branchId={branchId}
        department={editing}
        action={editAction}
        error={editState.error}
        saving={saving}
        onClose={() => setEditing(null)}
      />

      <Dialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleting?.nameEn}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This removes the department and frees the prefix{' '}
            <span className="font-semibold text-slate-800" dir="ltr">{deleting?.prefix}</span>.
            It only works while the department has never issued a token — once it has, its
            history keeps it, and deactivating is the way to retire it.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              disabled={pending}
              onClick={() => deleting && handleDelete(deleting)}
            >
              {pending ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Shared by the add and edit forms so the two can't drift. Uncontrolled inputs
// with defaults, matching the rest of the school admin forms — only colour and
// icon need state, because they're pickers writing to a hidden field.
function DepartmentFields({ department }: { department?: SchoolDepartmentDTO }) {
  const [color, setColor] = useState(department?.color ?? SCHOOL_DEPARTMENT_COLORS[0])
  const [icon, setIcon] = useState(department?.icon ?? 'Building2')

  return (
    <>
      {regionLocales().map((l, i) => (
        <div key={l} className="space-y-1.5">
          <Label htmlFor={`name_${l}`}>
            {i === 0 ? 'Name' : `Name (${LOCALE_LABEL[l]})`}
          </Label>
          <Input
            id={`name_${l}`}
            name={`name_${l}`}
            required={i === 0}
            maxLength={100}
            dir={dirFor(l)}
            placeholder={i === 0 ? 'Fees & Accounts' : undefined}
            defaultValue={department?.name?.[l] ?? (l === 'en' ? department?.nameEn : l === 'ar' ? department?.nameAr : '')}
          />
        </div>
      ))}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="prefix">Token prefix</Label>
          <Input
            id="prefix" name="prefix" required maxLength={3} placeholder="F"
            className="uppercase tabular-nums"
            defaultValue={department?.prefix}
          />
          <p className="text-[11px] text-muted-foreground">1–3 letters. Tokens read F101, F102…</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="numberStart">Starts at</Label>
          <Input
            id="numberStart" name="numberStart" type="number" min={1} max={99999}
            defaultValue={department?.numberStart ?? 101}
          />
          {department && (
            <p className="text-[11px] text-muted-foreground">
              Takes effect on the next service day — today&apos;s series keeps running.
            </p>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Colour</Label>
        <input type="hidden" name="color" value={color} />
        <div className="flex flex-wrap gap-1.5">
          {SCHOOL_DEPARTMENT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Colour ${c}`}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
              style={{ backgroundColor: c }}
              className={
                color === c
                  ? 'size-8 rounded-lg ring-2 ring-slate-900 ring-offset-2'
                  : 'size-8 rounded-lg'
              }
            />
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          This is the tile on the kiosk and the stripe on the TV board.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Icon</Label>
        <input type="hidden" name="icon" value={icon} />
        <div className="grid max-h-40 grid-cols-8 gap-1.5 overflow-y-auto rounded-xl border border-border p-2">
          {SCHOOL_DEPARTMENT_ICONS.map((name) => (
            <button
              key={name}
              type="button"
              title={name}
              aria-label={name}
              aria-pressed={icon === name}
              onClick={() => setIcon(name)}
              className={
                icon === name
                  ? 'flex aspect-square items-center justify-center rounded-lg border-2 border-accent-400 bg-accent-50 text-accent-700'
                  : 'flex aspect-square items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50'
              }
            >
              <DepartmentIcon name={name} className="size-4" />
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
        <div>
          <p className="text-sm font-medium text-slate-800">Priority queue</p>
          <p className="text-[11px] text-muted-foreground">
            Senior citizens and visitors needing assistance jump the line
          </p>
        </div>
        <Switch name="isPriority" defaultChecked={department?.isPriority} />
      </div>
    </>
  )
}

function EditDialog({ branchId, department, action, error, saving, onClose }: {
  branchId: string
  department: SchoolDepartmentDTO | null
  action: (formData: FormData) => void
  error?: string
  saving: boolean
  onClose: () => void
}) {
  return (
    <Dialog open={!!department} onOpenChange={(v) => !v && onClose()}>
      {/* Remounts the form per department so the uncontrolled defaults reload. */}
      <DialogContent key={department?.id}>
        <DialogHeader>
          <DialogTitle>Edit Department</DialogTitle>
        </DialogHeader>
        {department && (
          <form action={action} className="space-y-4">
            <input type="hidden" name="departmentId" value={department.id} />
            <input type="hidden" name="branchId" value={branchId} />
            <DepartmentFields department={department} />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button
              type="submit"
              disabled={saving}
              className="w-full bg-accent-600 hover:bg-accent-700 text-white"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

// One department, one desk: a counter that serves only it, plus (optionally) a
// calling display that lists only that counter and a kiosk whose tickets only
// that counter can call. Everything it creates can be edited afterwards on the
// Counters and Devices pages.
function DeskDialog({ department, pending, onClose, onProvision }: {
  branchId: string
  department: SchoolDepartmentDTO | null
  pending: boolean
  onClose: () => void
  onProvision: (dept: SchoolDepartmentDTO, withDisplay: boolean, withKiosk: boolean) => void
}) {
  const [withDisplay, setWithDisplay] = useState(true)
  const [withKiosk, setWithKiosk] = useState(true)

  return (
    <Dialog open={!!department} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set up a desk for {department?.nameEn}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Creates a counter that serves only this department. It counts against your counter
          allowance{withDisplay ? ' and, with a display, your screen allowance' : ''}.
        </p>
        <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
          <span>
            <span className="block text-sm font-medium text-slate-800">Calling display</span>
            <span className="block text-xs text-muted-foreground">A TV that lists only this desk</span>
          </span>
          <Switch checked={withDisplay} onCheckedChange={setWithDisplay} />
        </label>
        <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
          <span>
            <span className="block text-sm font-medium text-slate-800">Ticket kiosk</span>
            <span className="block text-xs text-muted-foreground">
              Its tickets can only be called by this desk
            </span>
          </span>
          <Switch checked={withKiosk} onCheckedChange={setWithKiosk} />
        </label>
        <Button
          disabled={pending}
          onClick={() => department && onProvision(department, withDisplay, withKiosk)}
          className="w-full bg-accent-600 hover:bg-accent-700 text-white"
        >
          {pending ? 'Setting up…' : 'Create desk'}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
