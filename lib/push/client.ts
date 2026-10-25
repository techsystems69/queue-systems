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

type SaveFn = (subscription: PushSubscriptionJSON, userAgent: string) => Promise<{ error?: string }>
type RemoveFn = (endpoint: string) => Promise<{ error?: string }>

// Subscribes this browser to push (reusing an existing subscription) and
// (re)registers it with the server via `save` — which differs per recipient
// kind (hotel counter, school counter, manager). Safe to call on every page
// load: the server upserts on endpoint, which also refreshes a subscription the
// browser rotated since last time. Returns true when pushes will arrive.
export async function subscribeToPush(save: SaveFn): Promise<boolean> {
  if (!pushSupported()) return false
  try {
    const reg = await serviceWorkerReady()
    const key = urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!)
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    }
    const result = await save(sub.toJSON(), navigator.userAgent)
    return !result.error
  } catch {
    // Permission revoked, VAPID key rotated (InvalidStateError), or no network.
    return false
  }
}

// Turning alerts off: forget this browser on the server first, then drop the
// browser-side subscription so the push service stops accepting messages for it.
export async function unsubscribeFromPush(remove: RemoveFn): Promise<void> {
  if (!pushSupported()) return
  try {
    const reg = await serviceWorkerReady()
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return
    await remove(sub.endpoint).catch(() => {})
    await sub.unsubscribe()
  } catch { /* already gone */ }
}

export function closeNotificationsByTag(tag: string): void {
  navigator.serviceWorker?.getRegistration()
    .then(reg => reg?.getNotifications({ tag }))
    .then(list => list?.forEach(n => n.close()))
    .catch(() => {})
}
