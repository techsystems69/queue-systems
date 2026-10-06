'use client'

import { useState, useActionState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { DISTRIBUTOR_VERTICALS, DEFAULT_VERTICAL, verticalMeta } from '@/lib/verticals'
import type { CustomerVertical } from '@/lib/db/types'
import {
  createCustomerAction, toggleCustomerActiveAction, changePlanAction,
  setCustomerSchoolLimitsAction, setSchoolIdentityAction,
  setCustomerHospitalLimitsAction, updateCustomerAction, deleteCustomerAction,
} from '@/lib/actions/distributor'
import type { SchoolBranchIdentity } from '@/lib/db/school-types'
import { MAX_SCHOOL_ENTITLEMENT, MAX_HOSPITAL_ENTITLEMENT } from '@/lib/db/types'
import { dirFor, LOCALE_LABEL, regionLocales } from '@/lib/region'
import { Plus, Power, Copy, Check, Key, SlidersHorizontal, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { CustomerDTO } from '@/lib/db/types'

interface Plan {
  id: string
  name: string
  // NULL = sold under any vertical (Starter/Pro/Enterprise). Set on the three
  // hospital-only tiers — see supabase/migrations/20260905_hospital_plans.sql.
  vertical?: CustomerVertical | null
  default_department_limit?: number | null
  default_counter_limit?: number | null
}
type CustomerWithPlan = CustomerDTO & { planName?: string }

interface Props {
  customers: CustomerWithPlan[]
  plans: Plan[]
  // Branch branding, keyed by customer id. Only school tenants have entries.
  identities: Record<string, SchoolBranchIdentity[]>
}

// A plan scoped to another vertical can't be sold under this one.
function plansForVertical(plans: Plan[], vertical: CustomerVertical): Plan[] {
  return plans.filter(p => !p.vertical || p.vertical === vertical)
}

const INIT: { error?: string; licenseKey?: string } = {}

export function DistributorCustomersManager({ customers, plans, identities }: Props) {
  const [open, setOpen] = useState(false)
  // Which school/hospital tenant's setup — branding and allowance — is being edited.
  const [setupFor, setSetupFor] = useState<CustomerWithPlan | null>(null)
  const [editFor, setEditFor] = useState<CustomerWithPlan | null>(null)
  const [deleteFor, setDeleteFor] = useState<CustomerWithPlan | null>(null)
  // The key issued with this customer carries the system, and the customer row
  // is stamped with it too — so the tenant lands in the right product the very
  // first time they sign in.
  const [vertical, setVertical] = useState<CustomerVertical>(DEFAULT_VERTICAL)
  const availablePlans = plansForVertical(plans, vertical)
  const [planId, setPlanId] = useState(availablePlans[0]?.id ?? '')
  const [copied, setCopied] = useState(false)
  const [state, formAction, pending] = useActionState(createCustomerAction, INIT)

  function handleVerticalChange(v: CustomerVertical) {
    setVertical(v)
    const stillValid = plans.find(p => p.id === planId && (!p.vertical || p.vertical === v))
    if (!stillValid) setPlanId(plansForVertical(plans, v)[0]?.id ?? '')
  }

  const justCreated = !state.error && state !== INIT && state.licenseKey

  function copyKey(key: string) {
    navigator.clipboard.writeText(key).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function handleClose(val: boolean) {
    if (!val) setCopied(false)
    setOpen(val)
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={handleClose}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5">
              <Plus className="size-3.5" />
              Create Customer
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Create Customer</DialogTitle>
            </DialogHeader>

            {justCreated ? (
              /* ── Success: show the generated license key ── */
              <div className="space-y-4 py-2">
                <div className="flex items-center gap-3 rounded-xl bg-emerald-50 border border-emerald-200 p-4">
                  <Key className="size-5 text-emerald-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-emerald-700 mb-1">License Key Generated</p>
                    <p className="font-mono font-black text-lg text-emerald-900 tracking-widest">{state.licenseKey}</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Share this key with the client. They enter it at <span className="font-mono text-foreground">/onboard</span> to set up their own email and password.
                </p>
                <div className="flex gap-2">
                  <Button
                    className="flex-1 gap-1.5"
                    onClick={() => copyKey(state.licenseKey!)}
                  >
                    {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    {copied ? 'Copied!' : 'Copy Key'}
                  </Button>
                  <Button variant="outline" onClick={() => { setOpen(false) }}>Done</Button>
                </div>
              </div>
            ) : (
              /* ── Create form ── */
              <form action={formAction} className="space-y-4">
                <div className="space-y-1.5">
                  <Label>System</Label>
                  <Select value={vertical} onValueChange={(v) => handleVerticalChange(v as CustomerVertical)}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Select system" /></SelectTrigger>
                    <SelectContent>
                      {DISTRIBUTOR_VERTICALS.map(v => (
                        <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <input type="hidden" name="vertical" value={vertical} />
                  <p className="text-xs text-muted-foreground">
                    {verticalMeta(vertical).description}. This customer can only sign in
                    to the system chosen here.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Plan</Label>
                  <Select value={planId} onValueChange={setPlanId}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Select plan" /></SelectTrigger>
                    <SelectContent>
                      {availablePlans.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <input type="hidden" name="planId" value={planId} />
                  {(() => {
                    const chosen = availablePlans.find(p => p.id === planId)
                    if (vertical !== 'hospital' || !chosen || chosen.default_department_limit == null) return null
                    return (
                      <p className="text-[11px] text-muted-foreground">
                        Starts with {chosen.default_department_limit} departments,{' '}
                        {chosen.default_counter_limit} rooms — adjustable later from Hospital setup.
                      </p>
                    )
                  })()}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="businessName">Business Name</Label>
                  <Input id="businessName" name="businessName" placeholder="Acme Corp" required />
                  <p className="text-[11px] text-muted-foreground">The client can update this after signing in.</p>
                </div>
                {state.error && <p className="text-sm text-red-600">{state.error}</p>}
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={pending || !planId}>
                    {pending ? 'Creating…' : 'Create & Get Key'}
                  </Button>
                </div>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-xl border border-border bg-white overflow-hidden">
        <div className="divide-y divide-border">
          {customers.map(c => (
            <div key={c.id} className="flex items-center gap-3 px-5 py-4">
              <div className="size-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <span className="text-sm font-bold text-primary">{c.name.charAt(0)}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{c.name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  {/* Which product this tenant signs in to. Read-only here: it is
                      set by the key they redeemed, and a live tenant already has
                      rows in that product's tables. */}
                  <span
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                      c.vertical === 'school'
                        ? 'bg-violet-100 text-violet-700'
                        : c.vertical === 'hospital'
                        ? 'bg-rose-100 text-rose-700'
                        : 'bg-sky-100 text-sky-700'
                    }`}
                    title={verticalMeta(c.vertical).label}
                  >
                    {verticalMeta(c.vertical).short.toUpperCase()}
                  </span>
                  {c.planName && <span className="text-xs text-muted-foreground">{c.planName}</span>}
                  {/* What this tenant is entitled to build, per branch. The
                      tenant cannot raise it — that is the point of it living
                      here. */}
                  {c.vertical === 'school' && (
                    <span className="text-[10px] font-medium text-muted-foreground tabular-nums">
                      {c.maxSchoolDepartments} dept · {c.maxSchoolCounters} counter
                      {c.maxSchoolCounters === 1 ? '' : 's'}
                    </span>
                  )}
                  {c.vertical === 'hospital' && (
                    <span className="text-[10px] font-medium text-muted-foreground tabular-nums">
                      {c.maxHospitalDepartments} dept · {c.maxHospitalRooms} room
                      {c.maxHospitalRooms === 1 ? '' : 's'}
                    </span>
                  )}
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                    c.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {c.isActive ? 'ACTIVE' : 'INACTIVE'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Select
                  defaultValue={c.planId !== null ? c.planId : undefined}
                  onValueChange={async (newPlanId) => {
                    const r = await changePlanAction(c.id, newPlanId)
                    if (r.error) toast.error(r.error)
                    else toast.success('Plan updated')
                  }}
                >
                  <SelectTrigger className="h-7 text-xs w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {plansForVertical(plans, c.vertical).map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {c.vertical === 'school' && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs px-2"
                    onClick={() => setSetupFor(c)}
                  >
                    <SlidersHorizontal className="size-3.5 mr-1" />
                    School setup
                  </Button>
                )}
                {c.vertical === 'hospital' && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs px-2"
                    onClick={() => setSetupFor(c)}
                  >
                    <SlidersHorizontal className="size-3.5 mr-1" />
                    Hospital setup
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground"
                  onClick={() => setEditFor(c)}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs px-2 text-red-500 hover:text-red-600"
                  onClick={() => setDeleteFor(c)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={`h-7 text-xs px-2 ${c.isActive ? 'text-red-500 hover:text-red-600' : 'text-emerald-600 hover:text-emerald-700'}`}
                  onClick={async () => {
                    const r = await toggleCustomerActiveAction(c.id)
                    if (r.error) toast.error(r.error)
                  }}
                >
                  <Power className="size-3.5 mr-1" />
                  {c.isActive ? 'Disable' : 'Enable'}
                </Button>
              </div>
            </div>
          ))}
          {customers.length === 0 && (
            <div className="py-12 text-center text-sm text-muted-foreground">No customers yet.</div>
          )}
        </div>
      </div>

      <SchoolSetupDialog
        customer={setupFor?.vertical === 'school' ? setupFor : null}
        branches={setupFor ? identities[setupFor.id] ?? [] : []}
        onClose={() => setSetupFor(null)}
      />
      <HospitalSetupDialog
        customer={setupFor?.vertical === 'hospital' ? setupFor : null}
        onClose={() => setSetupFor(null)}
      />
      <EditCustomerDialog customer={editFor} onClose={() => setEditFor(null)} />
      <DeleteCustomerDialog customer={deleteFor} onClose={() => setDeleteFor(null)} />
    </div>
  )
}

// Everything about a school tenant that the tenant itself may not change:
// its branding (name and logo, which brand the TV board and every ticket) and
// its department/counter allowance. Two scopes in one dialog — identity is per
// branch, the allowance is per customer and applies at every branch — so each
// section saves on its own rather than sharing one ambiguous button.
function SchoolSetupDialog({ customer, branches, onClose }: {
  customer: CustomerWithPlan | null
  branches: SchoolBranchIdentity[]
  onClose: () => void
}) {
  const [forId, setForId] = useState<string | null>(null)
  const [departments, setDepartments] = useState('1')
  const [counters, setCounters] = useState('1')
  const [publicTracking, setPublicTracking] = useState(false)
  const [savingLimits, setSavingLimits] = useState(false)

  const [branchId, setBranchId] = useState('')
  const [nameByLocale, setNameByLocale] = useState<Record<string, string>>({})
  const [logoUrl, setLogoUrl] = useState('')
  const [savingIdentity, setSavingIdentity] = useState(false)

  function loadBranch(id: string, list: SchoolBranchIdentity[], customerName: string) {
    const b = list.find((x) => x.branchId === id)
    setBranchId(id)
    // A tenant created before branding moved here may have no name saved; fall
    // back to what the account is called so the field is never blank.
    const seed: Record<string, string> = {}
    for (const l of regionLocales()) {
      seed[l] = b?.schoolName?.[l]
        ?? (l === 'en' ? (b?.schoolNameEn || customerName) : l === 'ar' ? (b?.schoolNameAr ?? '') : '')
    }
    setNameByLocale(seed)
    setLogoUrl(b?.logoUrl ?? '')
  }

  if (customer && forId !== customer.id) {
    setForId(customer.id)
    setDepartments(String(customer.maxSchoolDepartments))
    setCounters(String(customer.maxSchoolCounters))
    setPublicTracking(customer.schoolPublicTrackingEnabled)
    loadBranch(branches[0]?.branchId ?? '', branches, customer.name)
  }

  async function saveLimits() {
    if (!customer) return
    setSavingLimits(true)
    const r = await setCustomerSchoolLimitsAction(customer.id, {
      maxSchoolDepartments: Number(departments),
      maxSchoolCounters: Number(counters),
      publicTrackingEnabled: publicTracking,
    })
    setSavingLimits(false)
    if (r.error) toast.error(r.error)
    else toast.success('Limits updated')
  }

  async function saveIdentity() {
    if (!branchId) return
    setSavingIdentity(true)
    const r = await setSchoolIdentityAction({ branchId, schoolName: nameByLocale, logoUrl })
    setSavingIdentity(false)
    if (r.error) toast.error(r.error)
    else toast.success('Identity updated')
  }

  return (
    <Dialog open={!!customer} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{customer?.name} — school setup</DialogTitle>
        </DialogHeader>

        {/* ── Identity ── */}
        <section className="space-y-3 rounded-xl border border-border p-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Identity</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Shown on the TV board and printed on every ticket. Read-only for the
              client on /school/settings.
            </p>
          </div>

          {branches.length === 0 ? (
            <p className="text-xs text-muted-foreground">This customer has no branches yet.</p>
          ) : (
            <>
              {/* Identity is per branch — a multi-campus tenant brands each one. */}
              {branches.length > 1 && (
                <div className="space-y-1.5">
                  <Label>Branch</Label>
                  <Select
                    value={branchId}
                    onValueChange={(v) => loadBranch(v, branches, customer?.name ?? '')}
                  >
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {branches.map((b) => (
                        <SelectItem key={b.branchId} value={b.branchId}>{b.branchName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {regionLocales().map((l, i) => (
                <div key={l} className="space-y-1.5">
                  <Label htmlFor={`schoolName_${l}`}>
                    {i === 0 ? 'School name' : `School name (${LOCALE_LABEL[l]})`}
                  </Label>
                  <Input
                    id={`schoolName_${l}`}
                    dir={dirFor(l)}
                    value={nameByLocale[l] ?? ''}
                    maxLength={120}
                    onChange={(e) => setNameByLocale((p) => ({ ...p, [l]: e.target.value }))}
                  />
                </div>
              ))}
              <div className="space-y-1.5">
                <Label htmlFor="logoUrl">Logo URL</Label>
                <Input
                  id="logoUrl"
                  value={logoUrl}
                  placeholder="https://…"
                  onChange={(e) => setLogoUrl(e.target.value)}
                />
              </div>
              <Button size="sm" onClick={saveIdentity} disabled={savingIdentity}>
                {savingIdentity ? 'Saving…' : 'Save Identity'}
              </Button>
            </>
          )}
        </section>

        {/* ── Limits ── */}
        <section className="space-y-3 rounded-xl border border-border p-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Limits</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              How many departments and counters this school can run at each branch.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="maxSchoolDepartments">Departments</Label>
              <Input
                id="maxSchoolDepartments"
                type="number"
                min={0}
                max={MAX_SCHOOL_ENTITLEMENT}
                value={departments}
                onChange={(e) => setDepartments(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="maxSchoolCounters">Counters</Label>
              <Input
                id="maxSchoolCounters"
                type="number"
                min={0}
                max={MAX_SCHOOL_ENTITLEMENT}
                value={counters}
                onChange={(e) => setCounters(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Lowering a number never removes anything the school already built — it just
            stops them adding more until they deactivate down to the new limit.
          </p>

          <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">Public ticket tracking (QR)</p>
              <p className="text-[11px] text-muted-foreground">
                Adds a QR code to every printed ticket linking to a live waiting-position
                page. The school has its own on/off switch on /school/settings — this is
                the grant that switch depends on.
              </p>
            </div>
            <Switch checked={publicTracking} onCheckedChange={setPublicTracking} />
          </div>

          <Button size="sm" onClick={saveLimits} disabled={savingLimits}>
            {savingLimits ? 'Saving…' : 'Save Limits'}
          </Button>
        </section>

        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Departments and rooms a hospital tenant may run, per branch — the same
// sold-capacity model as school (see SchoolSetupDialog above), plus the two
// hospital add-on grants. New customers start with the numbers baked into
// the plan they were sold (Clinic 2/4, Hospital 8/15, Multispecialist
// 30/40); this is where a distributor sells a customer extra capacity above
// that, or claws back what a downgraded/cancelled customer no longer gets.
function HospitalSetupDialog({ customer, onClose }: {
  customer: CustomerWithPlan | null
  onClose: () => void
}) {
  const [forId, setForId] = useState<string | null>(null)
  const [departments, setDepartments] = useState('0')
  const [rooms, setRooms] = useState('0')
  const [publicTracking, setPublicTracking] = useState(false)
  const [notifications, setNotifications] = useState(false)
  const [saving, setSaving] = useState(false)

  if (customer && forId !== customer.id) {
    setForId(customer.id)
    setDepartments(String(customer.maxHospitalDepartments))
    setRooms(String(customer.maxHospitalRooms))
    setPublicTracking(customer.hospitalPublicTrackingEnabled)
    setNotifications(customer.hospitalNotificationsEnabled)
  }

  async function save() {
    if (!customer) return
    setSaving(true)
    const r = await setCustomerHospitalLimitsAction(customer.id, {
      maxHospitalDepartments: Number(departments),
      maxHospitalRooms: Number(rooms),
      publicTrackingEnabled: publicTracking,
      notificationsEnabled: notifications,
    })
    setSaving(false)
    if (r.error) toast.error(r.error)
    else toast.success('Limits updated')
  }

  return (
    <Dialog open={!!customer} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{customer?.name} — hospital setup</DialogTitle>
        </DialogHeader>

        <section className="space-y-3 rounded-xl border border-border p-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Limits</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              How many departments and rooms this hospital can run at each branch.
              Set by the plan at signup — adjust here for a custom deal.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="maxHospitalDepartments">Departments</Label>
              <Input
                id="maxHospitalDepartments"
                type="number"
                min={0}
                max={MAX_HOSPITAL_ENTITLEMENT}
                value={departments}
                onChange={(e) => setDepartments(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="maxHospitalRooms">Rooms (counters)</Label>
              <Input
                id="maxHospitalRooms"
                type="number"
                min={0}
                max={MAX_HOSPITAL_ENTITLEMENT}
                value={rooms}
                onChange={(e) => setRooms(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Lowering a number never removes anything the hospital already built — it
            just stops them adding more until they deactivate down to the new limit.
            Add-on pricing for capacity above the plan: ₹299 / extra department
            (includes 1 room), ₹199 / extra room.
          </p>

          <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">Public ticket tracking (QR)</p>
              <p className="text-[11px] text-muted-foreground">
                Adds a QR code to every printed ticket linking to a live waiting-position
                page. The hospital has its own on/off switch on /hospital/settings — this
                is the grant that switch depends on.
              </p>
            </div>
            <Switch checked={publicTracking} onCheckedChange={setPublicTracking} />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">SMS / push notifications</p>
              <p className="text-[11px] text-muted-foreground">
                Lets the hospital notify patients as their turn approaches.
              </p>
            </div>
            <Switch checked={notifications} onCheckedChange={setNotifications} />
          </div>

          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save Limits'}
          </Button>
        </section>

        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// The business-facing profile fields any customer can have edited by the
// distributor — everything that isn't the plan, the vertical (locked to the
// redeemed key) or a vertical-specific entitlement (its own setup dialog).
function EditCustomerDialog({ customer, onClose }: {
  customer: CustomerWithPlan | null
  onClose: () => void
}) {
  const [forId, setForId] = useState<string | null>(null)
  const [businessName, setBusinessName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [primaryColor, setPrimaryColor] = useState('#0F172A')
  const [secondaryColor, setSecondaryColor] = useState('#6366F1')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>()

  if (customer && forId !== customer.id) {
    setForId(customer.id)
    setBusinessName(customer.businessName || customer.name)
    setPhone(customer.phone)
    setEmail(customer.email)
    setAddress(customer.address)
    setPrimaryColor(customer.primaryColor)
    setSecondaryColor(customer.secondaryColor)
    setError(undefined)
  }

  async function save() {
    if (!customer) return
    setSaving(true)
    const r = await updateCustomerAction(customer.id, {
      businessName, phone, email, address, primaryColor, secondaryColor,
    })
    setSaving(false)
    if (r.error) setError(r.error)
    else {
      setError(undefined)
      toast.success('Customer updated')
      onClose()
    }
  }

  return (
    <Dialog open={!!customer} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {customer?.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="editBusinessName">Business Name</Label>
            <Input id="editBusinessName" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="editPhone">Phone</Label>
              <Input id="editPhone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="editEmail">Email</Label>
              <Input id="editEmail" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="editAddress">Address</Label>
            <Input id="editAddress" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="editPrimaryColor">Primary Color</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  className="size-8 rounded border border-border shrink-0"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                />
                <Input id="editPrimaryColor" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="editSecondaryColor">Secondary Color</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  className="size-8 rounded border border-border shrink-0"
                  value={secondaryColor}
                  onChange={(e) => setSecondaryColor(e.target.value)}
                />
                <Input id="editSecondaryColor" value={secondaryColor} onChange={(e) => setSecondaryColor(e.target.value)} />
              </div>
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={saving || !businessName.trim()}>
              {saving ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Hard delete, guarded by typing the customer's exact name — every tenant
// table cascades from customers.id, so this permanently removes the
// customer and everything under it (branches, staff, queue history, tokens,
// patients). There is no undo, so "Disable" (which just flips is_active
// and keeps everything) is the button for the common case; this is for
// actually retiring a test tenant or an account that's really leaving.
function DeleteCustomerDialog({ customer, onClose }: {
  customer: CustomerWithPlan | null
  onClose: () => void
}) {
  const [forId, setForId] = useState<string | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | undefined>()

  if (customer && forId !== customer.id) {
    setForId(customer.id)
    setConfirmText('')
    setError(undefined)
  }

  async function doDelete() {
    if (!customer) return
    setDeleting(true)
    const r = await deleteCustomerAction(customer.id, customer.name)
    setDeleting(false)
    if (r.error) setError(r.error)
    else {
      toast.success(`${customer.name} deleted`)
      onClose()
    }
  }

  const canDelete = !!customer && confirmText === customer.name

  return (
    <Dialog open={!!customer} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete {customer?.name}?</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This permanently deletes the customer and everything under it — branches,
            staff logins, queue history, tokens/patients, screens, everything. There is
            no undo. If you just want to stop them signing in, use{' '}
            <span className="font-medium text-foreground">Disable</span> instead.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="confirmDeleteName">
              Type <span className="font-mono font-semibold text-foreground">{customer?.name}</span> to confirm
            </Label>
            <Input
              id="confirmDeleteName"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={doDelete}
              disabled={!canDelete || deleting}
            >
              {deleting ? 'Deleting…' : 'Delete Permanently'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
