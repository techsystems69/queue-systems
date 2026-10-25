'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { describeAlertItems } from '@/lib/counterNotifications'
import { closeNotificationsByTag } from '@/lib/push/client'
import { useAttention } from '@/lib/hooks/useAttention'
import { useAlertPreference, type AlertToggle } from '@/lib/hooks/useAlertPreference'

// A new item is only paged once it has stayed actionable this long. Counters
// register-and-call their own entries (Delivery/Call), which briefly appear as
// "waiting" before flipping to in-progress — that isn't work for anyone.
const SETTLE_MS = 1_500
const REMINDER_EVERY_MS = 30_000
const MAX_REMINDERS = 10
// How long the page waits for a server push to appear before showing its own.
const PUSH_GRACE_MS = 4_000

export interface AlertItem {
  id: string
  // What the notification calls it: "#12", "A014".
  label: string
}

interface Options {
  storageKey: string
  tag: string
  save: Parameters<typeof useAlertPreference>[0]['save']
  remove: Parameters<typeof useAlertPreference>[0]['remove']
  // Everything currently waiting on THIS counter; null while still loading.
  items: AlertItem[] | null
  heading: string
  noun: 'order' | 'token'
  phrase: string
}

// The in-page half of the alert system, behind a per-device on/off toggle.
//
// While the page is alive and polling/streaming, it diffs `items` and, when a
// new one settles while the operator is away (page hidden, or untouched for
// 30s), plays a chime, vibrates, flashes the tab title and repeats until they
// return. Server push (see /api/push/notify) covers the cases a page can't:
// closed browser, suspended tab. When this browser is registered for push the
// page leaves the system notification to it — unless none appears, in which
// case the page shows one itself.
export function useAlerts({ storageKey, tag, save, remove, items, heading, noun, phrase }: Options) {
  const toggle = useAlertPreference({ storageKey, tag, save, remove })
  const on = toggle.on
  const [unseenCount, setUnseenCount] = useState(0)

  const itemsRef = useRef(items)
  const pushActiveRef = useRef(false)
  const knownIdsRef = useRef<Set<string> | null>(null)
  const settleTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const batchRef = useRef<string[]>([])
  const flushRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const unseenIdsRef = useRef<Set<string>>(new Set())
  const reminderRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const remindersSentRef = useRef(0)
  const audioRef = useRef<AudioContext | null>(null)
  const baseTitleRef = useRef('')

  useEffect(() => {
    itemsRef.current = items
    pushActiveRef.current = toggle.pushActive
  }, [items, toggle.pushActive])

  const unlockAudio = useCallback(() => {
    try {
      if (!audioRef.current) {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!Ctx) return
        audioRef.current = new Ctx()
      }
      void audioRef.current.resume()
    } catch { /* audio is best-effort */ }
  }, [])

  const playChime = useCallback(() => {
    const ctx = audioRef.current
    if (!ctx || ctx.state !== 'running') return
    // Two rising tones, repeated once — distinct from ambient noise.
    const t0 = ctx.currentTime
    ;[0, 0.22, 0.6, 0.82].forEach((offset, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = i % 2 === 0 ? 880 : 1175
      gain.gain.setValueAtTime(0.0001, t0 + offset)
      gain.gain.exponentialRampToValueAtTime(0.35, t0 + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.2)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t0 + offset)
      osc.stop(t0 + offset + 0.22)
    })
  }, [])

  const showSystemNotification = useCallback(async (title: string, body: string) => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    // When registered for server push, the push normally shows the notification
    // (and may already have). Give it a moment, then act as the safety net: if
    // nothing is on screen and the alert is still open, the push didn't arrive
    // (webhook not configured, push-service delay, ...), so show it from here
    // rather than stay silent.
    if (pushActiveRef.current) {
      await new Promise(resolve => setTimeout(resolve, PUSH_GRACE_MS))
      if (unseenIdsRef.current.size === 0) return
      const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined)
      const shown = await reg?.getNotifications({ tag }).catch(() => [])
      if (shown?.length) return
    }
    const options: NotificationOptions & { renotify?: boolean; vibrate?: number[] } = {
      body,
      icon: '/icon.svg',
      tag,
      renotify: true,
      requireInteraction: true,
      vibrate: [200, 100, 200],
      data: { url: window.location.pathname },
    }
    try {
      // Android Chrome only allows notifications through a service worker.
      const reg = await navigator.serviceWorker?.getRegistration()
      if (reg) await reg.showNotification(`${heading} · ${title}`, options)
      else new Notification(`${heading} · ${title}`, options)
    } catch { /* notifications are best-effort */ }
  }, [heading, tag])

  const alertNow = useCallback(() => {
    const labels = (itemsRef.current ?? []).filter(i => unseenIdsRef.current.has(i.id)).map(i => i.label)
    if (labels.length === 0) return
    const { title, body } = describeAlertItems(noun, phrase, labels)
    playChime()
    navigator.vibrate?.([200, 100, 200])
    void showSystemNotification(title, body)
  }, [noun, phrase, playChime, showSystemNotification])

  // Also dismisses notifications pushed while the page was closed or hidden —
  // the page never saw those arrive, so it has no unseen ids for them.
  const clearUnseen = useCallback(() => {
    closeNotificationsByTag(tag)
    if (unseenIdsRef.current.size === 0) return
    unseenIdsRef.current.clear()
    setUnseenCount(0)
    remindersSentRef.current = 0
    if (reminderRef.current) {
      clearInterval(reminderRef.current)
      reminderRef.current = null
    }
  }, [tag])

  // Touching the page = the operator is looking: unlocks audio (browsers
  // require a gesture) and acknowledges any open alert. Listeners are always
  // on so the very tap that turns alerts on also unlocks sound.
  const { isAttentive } = useAttention({
    tag,
    onInteract: useCallback(() => {
      unlockAudio()
      clearUnseen()
    }, [unlockAudio, clearUnseen]),
  })

  const raise = useCallback((ids: string[]) => {
    if (isAttentive()) return
    ids.forEach(id => unseenIdsRef.current.add(id))
    setUnseenCount(unseenIdsRef.current.size)
    alertNow()
    if (!reminderRef.current) {
      reminderRef.current = setInterval(() => {
        if (unseenIdsRef.current.size === 0 || remindersSentRef.current >= MAX_REMINDERS) {
          if (reminderRef.current) clearInterval(reminderRef.current)
          reminderRef.current = null
          return
        }
        remindersSentRef.current += 1
        alertNow()
      }, REMINDER_EVERY_MS)
    }
  }, [alertNow, isAttentive])

  // Diff the live list: anything newly present becomes a candidate, and is
  // paged only if it is still present once it settles.
  useEffect(() => {
    const timers = settleTimersRef.current

    if (!on) {
      // Alerts off (or never on): forget everything so turning them on later
      // treats whatever is waiting then as backlog, not news.
      knownIdsRef.current = null
      timers.forEach(clearTimeout)
      timers.clear()
      return
    }
    if (items === null) return

    const current = new Set(items.map(i => i.id))

    // First snapshot is the backlog, not news.
    if (knownIdsRef.current === null) {
      knownIdsRef.current = current
      return
    }
    const known = knownIdsRef.current

    for (const id of current) {
      if (known.has(id) || timers.has(id)) continue
      timers.set(id, setTimeout(() => {
        timers.delete(id)
        const stillValid = (itemsRef.current ?? []).some(i => i.id === id)
        if (!stillValid) return
        // Items that settle together page once, not once each.
        batchRef.current.push(id)
        if (!flushRef.current) {
          flushRef.current = setTimeout(() => {
            flushRef.current = null
            const ids = batchRef.current
            batchRef.current = []
            raise(ids)
          }, 50)
        }
      }, SETTLE_MS))
    }
    knownIdsRef.current = new Set([...known, ...current])

    // Someone else handled it — it no longer needs this counter's attention.
    let changed = false
    for (const id of unseenIdsRef.current) {
      if (!current.has(id)) {
        unseenIdsRef.current.delete(id)
        changed = true
      }
    }
    if (changed) {
      setUnseenCount(unseenIdsRef.current.size)
      if (unseenIdsRef.current.size === 0) clearUnseen()
    }
  }, [items, on, raise, clearUnseen])

  // Switching alerts off silences anything still open.
  useEffect(() => {
    if (!on) clearUnseen()
  }, [on, clearUnseen])

  // Flash the tab title while something is waiting.
  useEffect(() => {
    if (unseenCount === 0) return
    baseTitleRef.current = document.title
    let flash = false
    const id = setInterval(() => {
      flash = !flash
      document.title = flash ? `(${unseenCount}) New — ${baseTitleRef.current}` : baseTitleRef.current
    }, 1000)
    return () => {
      clearInterval(id)
      document.title = baseTitleRef.current
    }
  }, [unseenCount])

  useEffect(() => {
    const timers = settleTimersRef.current
    return () => {
      timers.forEach(clearTimeout)
      timers.clear()
      if (flushRef.current) clearTimeout(flushRef.current)
      if (reminderRef.current) clearInterval(reminderRef.current)
      void audioRef.current?.close().catch(() => {})
      audioRef.current = null
    }
  }, [])

  const turnOn = useCallback(async () => {
    unlockAudio() // inside the tap, so the browser lets sound play later
    const result = await toggle.turnOn()
    if (!result.error) setTimeout(playChime, 150) // audible confirmation
    return result
  }, [toggle, unlockAudio, playChime])

  return {
    unseenCount,
    acknowledge: clearUnseen,
    toggle: { ...toggle, turnOn } satisfies AlertToggle,
  }
}
