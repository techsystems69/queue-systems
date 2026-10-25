'use client'

import { Bell, BellOff } from 'lucide-react'
import { toast } from 'sonner'
import { useManagerAlerts } from '@/lib/hooks/useManagerAlerts'

// Bell in every manager top bar. On = this browser is registered for push, so
// the manager hears about new orders/tokens in their branches even with the tab
// closed (the service worker stays quiet while they are actively looking).
export function ManagerAlertBell() {
  const alerts = useManagerAlerts()

  async function toggle() {
    if (alerts.on) {
      await alerts.turnOff()
      toast('Alerts off on this device')
      return
    }
    const result = await alerts.turnOn()
    if (result.error) toast.error(result.error)
    else toast.success('Alerts on — you’ll be notified of new activity, even when this tab is closed.')
  }

  const label = alerts.on ? 'Alerts on — tap to turn off' : 'Alerts off — tap to turn on'
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={alerts.busy}
      title={label}
      aria-label={label}
      aria-pressed={alerts.on}
      className={`relative shrink-0 rounded-lg border p-2 transition disabled:opacity-50 ${
        alerts.on
          ? 'border-accent-200 bg-accent-50 text-accent-700 active:bg-accent-100'
          : 'border-border bg-white text-slate-500 active:bg-slate-100'
      }`}
    >
      {alerts.on ? <Bell className="size-4" /> : <BellOff className="size-4" />}
      {alerts.on && <span className="absolute -top-0.5 -end-0.5 size-2 rounded-full bg-accent-500" />}
    </button>
  )
}
