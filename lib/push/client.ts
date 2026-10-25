import { savePushSubscriptionAction } from '@/lib/actions/push'

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  )
}

function urlBase64ToUint8Array(base64: string) {
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, ch => ch.charCodeAt(0))
}

// `ready` never settles if the service worker failed to register, so bound it.
function serviceWorkerReady(): Promise<ServiceWorkerRegistration> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('service worker not ready')), 10_000)),
  ])
}

// Subscribes this browser to push (reusing an existing subscription) and
// (re)registers it against the counter. Safe to call on every page load: the
// server upserts on endpoint, which also refreshes a subscription the browser
// rotated since last time. Returns true when the counter will receive pushes.
export async function subscribeToCounterPush(counterToken: string): Promise<boolean> {
  if (!pushSupported()) return false
  try {
    const reg = await serviceWorkerReady()
    const key = urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!)
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    }
    const result = await savePushSubscriptionAction(counterToken, sub.toJSON(), navigator.userAgent)
    if (result.error) return false
    return true
  } catch {
    // Permission revoked, VAPID key rotated (InvalidStateError), or no network.
    return false
  }
}
