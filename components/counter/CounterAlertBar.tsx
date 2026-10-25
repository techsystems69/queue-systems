'use client'

import { BellRing } from 'lucide-react'

interface Props {
  unseenCount: number
  onAcknowledge: () => void
}

// Banner-slot strip for the "someone needs you" state: something arrived while
// the operator was away. Shows nothing otherwise — turning alerts on/off lives
// in the header (AlertToggle).
export function CounterAlertBar({ unseenCount, onAcknowledge }: Props) {
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

  return null
}
