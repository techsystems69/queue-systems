'use client'

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { closeNotificationsByTag, subscribeToPush, unsubscribeFromPush } from '@/lib/push/client'

type AlertPermission = NotificationPermission | 'unsupported'

export interface AlertToggle {
  // Alerts are on for this device: the operator opted in and the browser allows it.
  on: boolean
  // The browser has blocked notifications for this site; the toggle can't turn on.
  blocked: boolean
  // Registered for server push (works with the browser closed).
  pushActive: boolean
  busy: boolean
  turnOn: () => Promise<{ error?: string }>
  turnOff: () => Promise<void>
}

// ── per-device "alerts on" flag, persisted in localStorage ────────────────
const listeners = new Set<() => void>()
function readFlag(key: string): boolean {
  try { return localStorage.getItem(key) === '1' } catch { return false }
}
function writeFlag(key: string, value: boolean) {
  try { localStorage.setItem(key, value ? '1' : '0') } catch { /* private mode */ }
  listeners.forEach(l => l())
}
function subscribeFlag(cb: () => void) {
  listeners.add(cb)
  window.addEventListener('storage', cb)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', cb)
  }
}

const noopSubscribe = () => () => {}
const readPermission = (): AlertPermission =>
  typeof Notification === 'undefined' ? 'unsupported' : Notification.permission

interface Options {
  // localStorage key — one per counter token, or a fixed one for managers.
  storageKey: string
  tag: string
  save: Parameters<typeof subscribeToPush>[0]
  remove: Parameters<typeof unsubscribeFromPush>[0]
}

// The on/off state behind every alerts toggle (counter header or manager bell).
// Opting in needs a tap — browsers only show the permission prompt in response
// to a gesture — so alerts are off until someone turns them on, and stay on
// across reloads on that device. While on, each load re-registers for push so a
// rotated or expired subscription heals itself.
export function useAlertPreference({ storageKey, tag, save, remove }: Options): AlertToggle {
  const wanted = useSyncExternalStore(subscribeFlag, () => readFlag(storageKey), () => false)
  // Server render and hydration see 'default'; the live value is read after.
  const browserPermission = useSyncExternalStore(noopSubscribe, readPermission, () => 'default' as AlertPermission)
  const [requested, setRequested] = useState<AlertPermission | null>(null)
  const permission = requested ?? browserPermission

  const [pushActive, setPushActive] = useState(false)
  const [busy, setBusy] = useState(false)

  const on = wanted && (permission === 'granted' || permission === 'unsupported')

  useEffect(() => {
    if (!on || permission !== 'granted') return
    let alive = true
    subscribeToPush(save).then(ok => { if (alive) setPushActive(ok) })
    return () => { alive = false }
    // `save` is a stable per-page closure; re-running on identity would resubscribe needlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, permission, storageKey])

  const turnOn = useCallback(async (): Promise<{ error?: string }> => {
    setBusy(true)
    try {
      let result = readPermission()
      if (result === 'default') {
        result = await Notification.requestPermission()
        setRequested(result)
      }
      if (result === 'denied') {
        return { error: 'Notifications are blocked for this site. Allow them in the browser’s site settings, then try again.' }
      }
      writeFlag(storageKey, true)
      return {}
    } finally {
      setBusy(false)
    }
  }, [storageKey])

  const turnOff = useCallback(async () => {
    setBusy(true)
    writeFlag(storageKey, false)
    setPushActive(false)
    closeNotificationsByTag(tag)
    await unsubscribeFromPush(remove)
    setBusy(false)
  }, [storageKey, tag, remove])

  return { on, blocked: permission === 'denied', pushActive, busy, turnOn, turnOff }
}
