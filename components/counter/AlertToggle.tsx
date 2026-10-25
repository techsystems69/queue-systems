'use client'

import { Bell, BellOff } from 'lucide-react'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import type { AlertToggle as AlertToggleState } from '@/lib/hooks/useAlertPreference'

// Header switch on a counter terminal: alerts for this device on/off. Off by
// default and loud about it (amber) — browsers only show the notification
// permission prompt in response to a tap, so this switch is how a counter gets
// opted in.
export function AlertToggle({ toggle }: { toggle: AlertToggleState }) {
  async function change(next: boolean) {
    if (next) {
      const result = await toggle.turnOn()
      if (result.error) toast.error(result.error)
      else toast.success('Alerts on — you’ll be notified when someone is waiting, even if this tab is closed.')
    } else {
      await toggle.turnOff()
      toast('Alerts off')
    }
  }

  return (
    <label className="flex items-center gap-2 rounded-2xl bg-slate-50 border border-slate-200 ps-3 pe-2 py-1.5 select-none">
      {toggle.on
        ? <Bell className="size-3.5 text-accent-600" />
        : <BellOff className="size-3.5 text-amber-600" />}
      <span className={`text-[11px] font-bold uppercase tracking-wide whitespace-nowrap ${toggle.on ? 'text-accent-700' : 'text-amber-600'}`}>
        {toggle.on ? 'Alerts on' : 'Alerts off'}
      </span>
      <Switch
        checked={toggle.on}
        disabled={toggle.busy}
        onCheckedChange={change}
        aria-label="New order alerts"
      />
    </label>
  )
}
