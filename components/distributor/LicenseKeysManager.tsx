'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { generateLicenseKeyAction, setLicenseKeyVerticalAction } from '@/lib/actions/distributor'
import { VERTICALS, DISTRIBUTOR_VERTICALS, DEFAULT_VERTICAL, verticalMeta } from '@/lib/verticals'
import type { CustomerVertical } from '@/lib/db/types'
import { Plus, Copy, CheckCircle2, Lock } from 'lucide-react'
import { toast } from 'sonner'

interface LicenseKey {
  id: string
  key: string
  plan_id: string
  used_at: string | null
  notes: string | null
  vertical: CustomerVertical | null
  created_at: string
}
interface Plan { id: string; name: string; vertical: CustomerVertical | null }

interface Props {
  keys: LicenseKey[]
  plans: Plan[]
}

export function LicenseKeysManager({ keys, plans }: Props) {
  // Which product the key entitles its customer to. Chosen here, at issue
  // time — this is the only thing that decides which dashboard the customer
  // ever sees, so it sits next to the plan rather than behind a menu.
  const [selectedVertical, setSelectedVertical] = useState<CustomerVertical>(DEFAULT_VERTICAL)
  // A plan scoped to another vertical (e.g. Clinic, hospital-only) can't be
  // issued for a key of this vertical — same rule as the customers page.
  const plansForVertical = plans.filter(p => !p.vertical || p.vertical === selectedVertical)
  const [selectedPlan, setSelectedPlan] = useState(plansForVertical[0]?.id ?? '')
  const [generatedKey, setGeneratedKey] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleSelectVertical(v: CustomerVertical) {
    setSelectedVertical(v)
    const stillValid = plans.find(p => p.id === selectedPlan && (!p.vertical || p.vertical === v))
    if (!stillValid) {
      setSelectedPlan(plans.find(p => !p.vertical || p.vertical === v)?.id ?? '')
    }
  }

  function handleGenerate() {
    if (!selectedPlan) return
    startTransition(async () => {
      const result = await generateLicenseKeyAction(selectedPlan, undefined, selectedVertical)
      if (result.error) toast.error(result.error)
      else {
        setGeneratedKey(result.key ?? null)
        toast.success(`${verticalMeta(selectedVertical).label} key generated`)
      }
    })
  }

  function handleChangeVertical(keyId: string, vertical: CustomerVertical) {
    startTransition(async () => {
      const result = await setLicenseKeyVerticalAction(keyId, vertical)
      if (result.error) toast.error(result.error)
      else toast.success(`Switched to ${verticalMeta(vertical).label}`)
    })
  }

  function copyKey(key: string) {
    navigator.clipboard.writeText(key).then(() => toast.success('Copied!'))
  }

  return (
    <div className="space-y-6">
      {/* Generator */}
      <div className="rounded-xl border border-border bg-white p-5 space-y-4">
        <h3 className="text-sm font-semibold">Generate New Key</h3>
        <div className="flex items-center gap-3">
          <Select value={selectedPlan} onValueChange={setSelectedPlan}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Select plan" />
            </SelectTrigger>
            <SelectContent>
              {plansForVertical.map(p => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={selectedVertical}
            onValueChange={(v) => handleSelectVertical(v as CustomerVertical)}
          >
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Select system" />
            </SelectTrigger>
            <SelectContent>
              {DISTRIBUTOR_VERTICALS.map(v => (
                <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={handleGenerate} disabled={!selectedPlan || pending} className="gap-1.5">
            <Plus className="size-3.5" />
            Generate
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {verticalMeta(selectedVertical).description}. The customer who redeems this key
          can only sign in to that system.
        </p>
        {generatedKey && (
          <div className="flex items-center gap-3 rounded-lg bg-emerald-50 border border-emerald-200 p-3">
            <span className="font-mono font-bold text-emerald-800 flex-1 tracking-widest">{generatedKey}</span>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => copyKey(generatedKey)}>
              <Copy className="size-3.5 mr-1" />
              Copy
            </Button>
          </div>
        )}
      </div>

      {/* Keys list */}
      <div className="rounded-xl border border-border bg-white overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <h3 className="text-sm font-semibold">All Keys</h3>
        </div>
        <div className="divide-y divide-border">
          {keys.map(k => {
            const plan = plans.find(p => p.id === k.plan_id)
            return (
              <div key={k.id} className="flex items-center gap-3 px-5 py-3">
                <div className="flex-1 min-w-0">
                  <span className="font-mono text-sm font-semibold tracking-widest text-gray-800">{k.key}</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                        k.vertical === 'school'
                          ? 'bg-violet-100 text-violet-700'
                          : 'bg-sky-100 text-sky-700'
                      }`}
                    >
                      {verticalMeta(k.vertical).short.toUpperCase()}
                    </span>
                    {plan && <span className="text-xs text-muted-foreground">{plan.name}</span>}
                    {k.notes && <span className="text-xs text-muted-foreground">• {k.notes}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {k.used_at ? (
                    <span
                      className="inline-flex items-center gap-1 text-[10px] font-semibold bg-gray-100 text-gray-500 px-2 py-0.5 rounded"
                      title="Redeemed — the system is locked to the customer behind it"
                    >
                      <Lock className="size-2.5" />
                      USED
                    </span>
                  ) : (
                    <>
                      {/* Changeable only while unredeemed: once a tenant exists it
                          may already hold rows in that product's tables. */}
                      <Select
                        value={verticalMeta(k.vertical).value}
                        onValueChange={(v) => handleChangeVertical(k.id, v as CustomerVertical)}
                        disabled={pending}
                      >
                        <SelectTrigger className="h-7 w-40 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {/* keep a key's current system visible even if it's no longer sold */}
                          {VERTICALS.filter(v => v.value === k.vertical || DISTRIBUTOR_VERTICALS.includes(v)).map(v => (
                            <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded">
                        <CheckCircle2 className="size-2.5" />
                        AVAILABLE
                      </span>
                      <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => copyKey(k.key)}>
                        <Copy className="size-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
          {keys.length === 0 && (
            <div className="py-10 text-center text-sm text-muted-foreground">No keys yet.</div>
          )}
        </div>
      </div>
    </div>
  )
}
