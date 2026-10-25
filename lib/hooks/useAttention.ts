'use client'

import { useCallback, useEffect, useRef } from 'react'

// Staff count as "attentive" when the page is visible AND they touched it
// recently. Orders/tokens that arrive while attentive are already on their
// screen, so they never raise an alert.
export const IDLE_AFTER_MS = 30_000

interface Options {
  // Which notification tag this page answers the service worker's "is anyone
  // looking?" check for. A manager tab must not vouch for a counter alert.
  tag: string
  // Called on every touch/keypress and when the page becomes visible again.
  onInteract?: () => void
}

// Tracks whether the operator is looking at this page and answers the service
// worker's attention check (so a pushed notification stays quiet when it would
// only repeat what is on screen).
export function useAttention({ tag, onInteract }: Options) {
  const lastInteractionRef = useRef(0)
  const onInteractRef = useRef(onInteract)

  useEffect(() => {
    onInteractRef.current = onInteract
  }, [onInteract])

  const isAttentive = useCallback(
    () => document.visibilityState === 'visible' && Date.now() - lastInteractionRef.current < IDLE_AFTER_MS,
    []
  )

  useEffect(() => {
    lastInteractionRef.current = Date.now()
    function touch() {
      lastInteractionRef.current = Date.now()
      onInteractRef.current?.()
    }
    function onVisibility() {
      if (document.visibilityState === 'visible') touch()
    }
    function onWorkerMessage(ev: MessageEvent) {
      if (ev.data?.type !== 'counter-push-check') return
      const matches = !ev.data.tag || ev.data.tag === tag
      ev.ports[0]?.postMessage(matches && isAttentive())
    }
    const events = ['pointerdown', 'keydown', 'touchstart'] as const
    events.forEach(ev => window.addEventListener(ev, touch, { passive: true }))
    document.addEventListener('visibilitychange', onVisibility)
    navigator.serviceWorker?.addEventListener('message', onWorkerMessage)
    return () => {
      events.forEach(ev => window.removeEventListener(ev, touch))
      document.removeEventListener('visibilitychange', onVisibility)
      navigator.serviceWorker?.removeEventListener('message', onWorkerMessage)
    }
  }, [tag, isAttentive])

  return { isAttentive }
}
