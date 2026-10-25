'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { actionableEntries, describeAlert, isNotifiable } from '@/lib/counterNotifications'
import { subscribeToCounterPush } from '@/lib/push/client'
import type { CounterType, QueueEntryDTO } from '@/lib/db/types'

// Staff count as "attentive" when the page is visible AND they touched it
// recently. Orders that arrive while attentive are already on their screen,
// so they never raise an alert.
const IDLE_AFTER_MS = 30_000
// A new entry is only paged once it has stayed actionable this long. Counters
// register-and-call their own entries (Delivery/Call), which briefly appear as
// "ready" before flipping to in-progress — that isn't work for anyone.
const SETTLE_MS = 1_500
const REMINDER_EVERY_MS = 30_000
const MAX_REMINDERS = 10
const NOTIFICATION_TAG = 'counter-alert'

type AlertPermission = NotificationPermission | 'unsupported'

const noopSubscribe = () => () => {}
const readPermission = (): AlertPermission =>
  typeof Notification === 'undefined' ? 'unsupported' : Notification.permission

interface Options {
  counterType: CounterType
  counterToken: string
  counterName: string
  entries: QueueEntryDTO[]
  isLoading: boolean
}

export function useCounterNotifications({ counterType, counterToken, counterName, entries, isLoading }: Options) {
  const enabled = isNotifiable(counterType)
  const [unseenCount, setUnseenCount] = useState(0)
  // Server render and hydration see 'default'; the live value is read after.
  const browserPermission = useSyncExternalStore(noopSubscribe, readPermission, () => 'default' as AlertPermission)
  const [requestedPermission, setRequestedPermission] = useState<AlertPermission | null>(null)
  const permission = requestedPermission ?? browserPermission
  const [audioReady, setAudioReady] = useState(false)

  const entriesRef = useRef(entries)
  const lastInteractionRef = useRef(0)
  const knownIdsRef = useRef<Set<string> | null>(null)
  const settleTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const batchRef = useRef<string[]>([])
  const flushRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const unseenIdsRef = useRef<Set<string>>(new Set())
  const reminderRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const remindersSentRef = useRef(0)
  const audioRef = useRef<AudioContext | null>(null)
  // True once this browser is registered for server push. Push then owns the
  // system notification (it also works with the page closed), so the page
  // doesn't raise a duplicate.
  const pushActiveRef = useRef(false)
  const baseTitleRef = useRef('')

  // Declared before the diff effect so timers always read the latest queue.
  useEffect(() => {
    entriesRef.current = entries
  }, [entries])

  const isAttentive = useCallback(
    () => document.visibilityState === 'visible' && Date.now() - lastInteractionRef.current < IDLE_AFTER_MS,
    []
  )

  const unlockAudio = useCallback(() => {
    try {
      if (!audioRef.current) {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!Ctx) {
          setAudioReady(true) // nothing to unlock — don't nag for it
          return
        }
        audioRef.current = new Ctx()
      }
      void audioRef.current.resume().then(() => setAudioReady(audioRef.current?.state === 'running'))
    } catch { /* audio is best-effort */ }
  }, [])

  const playChime = useCallback(() => {
    const ctx = audioRef.current
    if (!ctx || ctx.state !== 'running') return
    // Two rising tones, repeated once — distinct from ambient kitchen noise.
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
    if (pushActiveRef.current) return
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    const options: NotificationOptions & { renotify?: boolean; vibrate?: number[] } = {
      body,
      icon: '/icon.svg',
      tag: NOTIFICATION_TAG,
      renotify: true,
      requireInteraction: true,
      vibrate: [200, 100, 200],
      data: { url: window.location.pathname },
    }
    try {
      // Android Chrome only allows notifications through a service worker.
      const reg = await navigator.serviceWorker?.getRegistration()
      if (reg) await reg.showNotification(`${counterName} · ${title}`, options)
      else new Notification(`${counterName} · ${title}`, options)
    } catch { /* notifications are best-effort */ }
  }, [counterName])

  const alertNow = useCallback(() => {
    const pending = entriesRef.current.filter(e => unseenIdsRef.current.has(e.id))
    if (pending.length === 0) return
    const { title, body } = describeAlert(counterType, pending)
    playChime()
    navigator.vibrate?.([200, 100, 200])
    void showSystemNotification(title, body)
  }, [counterType, playChime, showSystemNotification])

  // Also dismisses notifications pushed while the page was closed or hidden —
  // the page never saw those orders arrive, so it has no unseen ids for them.
  const closeNotifications = useCallback(() => {
    navigator.serviceWorker?.getRegistration()
      .then(reg => reg?.getNotifications({ tag: NOTIFICATION_TAG }))
      .then(list => list?.forEach(n => n.close()))
      .catch(() => {})
  }, [])

  const clearUnseen = useCallback(() => {
    closeNotifications()
    if (unseenIdsRef.current.size === 0) return
    unseenIdsRef.current.clear()
    setUnseenCount(0)
    remindersSentRef.current = 0
    if (reminderRef.current) {
      clearInterval(reminderRef.current)
      reminderRef.current = null
    }
  }, [closeNotifications])

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

  // Interaction = the operator is looking. Touching the page also unlocks
  // audio (browsers require a gesture) and acknowledges any open alert.
  useEffect(() => {
    if (!enabled) return
    lastInteractionRef.current = Date.now()
    function onInteract() {
      lastInteractionRef.current = Date.now()
      unlockAudio()
      clearUnseen()
    }
    function onVisibility() {
      if (document.visibilityState !== 'visible') return
      lastInteractionRef.current = Date.now()
      closeNotifications()
    }
    // The service worker asks a visible page whether its operator is looking
    // before showing a pushed notification; if so, it stays quiet.
    function onWorkerMessage(ev: MessageEvent) {
      if (ev.data?.type === 'counter-push-check') ev.ports[0]?.postMessage(isAttentive())
    }
    const events = ['pointerdown', 'keydown', 'touchstart'] as const
    events.forEach(ev => window.addEventListener(ev, onInteract, { passive: true }))
    document.addEventListener('visibilitychange', onVisibility)
    navigator.serviceWorker?.addEventListener('message', onWorkerMessage)
    return () => {
      events.forEach(ev => window.removeEventListener(ev, onInteract))
      document.removeEventListener('visibilitychange', onVisibility)
      navigator.serviceWorker?.removeEventListener('message', onWorkerMessage)
    }
  }, [enabled, unlockAudio, clearUnseen, closeNotifications, isAttentive])

  // Once the browser has granted notifications, register for server push —
  // on every load, so a rotated or expired subscription heals itself.
  useEffect(() => {
    if (!enabled || permission !== 'granted') return
    let alive = true
    subscribeToCounterPush(counterToken).then(ok => {
      if (alive) pushActiveRef.current = ok
    })
    return () => { alive = false }
  }, [enabled, permission, counterToken])

  // Diff the live queue: anything newly actionable for this counter becomes a
  // candidate, and is paged only if it is still actionable once it settles.
  useEffect(() => {
    if (!enabled || isLoading) return
    const current = new Set(actionableEntries(counterType, entries).map(e => e.id))

    // First snapshot is the backlog, not news.
    if (knownIdsRef.current === null) {
      knownIdsRef.current = current
      return
    }
    const known = knownIdsRef.current
    const timers = settleTimersRef.current

    for (const id of current) {
      if (known.has(id) || timers.has(id)) continue
      timers.set(id, setTimeout(() => {
        timers.delete(id)
        const stillValid = actionableEntries(counterType, entriesRef.current).some(e => e.id === id)
        if (!stillValid) return
        // Orders that settle together page once, not once each.
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
  }, [entries, isLoading, enabled, counterType, raise, clearUnseen])

  // Flash the tab title while something is waiting.
  useEffect(() => {
    if (unseenCount === 0) return
    baseTitleRef.current = document.title
    let on = false
    const id = setInterval(() => {
      on = !on
      document.title = on ? `(${unseenCount}) New — ${baseTitleRef.current}` : baseTitleRef.current
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
      setAudioReady(false)
      void audioRef.current?.close().catch(() => {})
      audioRef.current = null
    }
  }, [])

  // Must run from a tap: grants audio + asks for system-notification access.
  const enableAlerts = useCallback(async () => {
    unlockAudio()
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      setRequestedPermission(await Notification.requestPermission())
    }
    setTimeout(playChime, 150)
  }, [unlockAudio, playChime])

  return {
    enabled,
    unseenCount,
    needsSetup: enabled && (permission === 'default' || !audioReady),
    enableAlerts,
    acknowledge: clearUnseen,
  }
}
