'use client'

import { Bell, BellRing } from 'lucide-react'

interface Props {
  unseenCount: number
  needsSetup: boolean
  onEnable: () => void
  onAcknowledge: () => void
}

// Banner-slot strip for the notification system. Shows nothing while alerts
// are set up and quiet; otherwise either the "someone needs you" state (an
// order arrived while the operator was away) or a one-tap setup prompt that
// grants the sound + system-notification permissions (both need a gesture).
export function CounterAlertBar({ unseenCount, needsSetup, onEnable, onAcknowledge }: Props) {
  if (unseenCount > 0) {
    return (
      <button
        type="button"
        onClick={onAcknowledge}
        className="shrink-0 w-full bg-red-50 border-b border-red-200 px-3 py-1.5 flex items-center gap-2 text-start"
      >
        <BellRing className="size-3.5 text-red-600 shrink-0 animate-pulse" />
        <p className="text-xs text-red-800 truncate min-w-0">
          <span className="font-bold">
            {unseenCount === 1 ? 'New order waiting' : `${unseenCount} new orders waiting`}
          </span>
          {' — tap to dismiss.'}
        </p>
      </button>
    )
  }

  if (needsSetup) {
    return (
      <button
        type="button"
        onClick={onEnable}
        className="shrink-0 w-full bg-slate-50 border-b border-slate-200 px-3 py-1.5 flex items-center gap-2 text-start"
      >
        <Bell className="size-3.5 text-slate-500 shrink-0" />
        <p className="text-xs text-slate-600 truncate min-w-0">
          <span className="font-bold">Enable alerts</span>
          {' — get a sound and notification when new orders arrive while you’re away.'}
        </p>
      </button>
    )
  }

  return null
}
