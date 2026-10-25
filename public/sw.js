const CACHE = "vibequeue-v1"
const PRECACHE = ["/", "/display", "/dashboard", "/icon.svg"]

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  )
})

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return
  const url = new URL(e.request.url)
  // Skip cross-origin, API routes, and Next.js internals
  if (url.origin !== location.origin) return
  if (url.pathname.startsWith("/_next/") || url.pathname.startsWith("/api/")) return
  // Never cache HTML navigation requests — always fetch fresh to avoid stale-chunk loops
  if (e.request.mode === "navigate") return

  e.respondWith(
    caches.match(e.request).then((cached) => {
      const networkFetch = fetch(e.request).then((res) => {
        if (res.ok) {
          caches.open(CACHE).then((c) => c.put(e.request, res.clone()))
        }
        return res
      })

      if (cached) {
        // Background revalidation — swallow errors so they don't surface as unhandled rejections
        networkFetch.catch(() => {})
        return cached
      }
      return networkFetch
    })
  )
})

const ALERT_TAG = "counter-alert"
// A notification still on screen from long ago is not part of "now".
const MERGE_WINDOW_MS = 10 * 60 * 1000

// Ask a visible counter page whether its operator is actually looking (the
// page owns that idle/visibility logic). No answer in time counts as "no".
function askAttentive(client) {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => resolve(false), 800)
    channel.port1.onmessage = (ev) => {
      clearTimeout(timer)
      resolve(ev.data === true)
    }
    client.postMessage({ type: "counter-push-check" }, [channel.port2])
  })
}

async function showCounterAlert(data) {
  const windows = await clients.matchAll({ type: "window", includeUncontrolled: true })
  const visible = windows.filter((c) => c.visibilityState === "visible")
  // Only skipping when a page is on screen is permitted by the Push API, and
  // only worth it when its operator is already looking at the new order.
  if (visible.length && (await Promise.all(visible.map(askAttentive))).some(Boolean)) return

  // Bursts (e.g. a kitchen going offline releases many orders) collapse into
  // one notification instead of a stack. Wording mirrors describeAlert() in
  // lib/counterNotifications.ts.
  const existing = await self.registration.getNotifications({ tag: ALERT_TAG })
  const fresh = existing.find((n) => n.data && Date.now() - n.data.at < MERGE_WINDOW_MS)
  const numbers = [...new Set([...(fresh?.data.numbers ?? []), data.number])].sort((a, b) => a - b)

  let title, body
  if (numbers.length === 1) {
    title = `${data.counterName} · Order #${numbers[0]}`
    body = `Order #${numbers[0]} is ${data.what}`
  } else {
    const shown = numbers.slice(0, 4).map((n) => `#${n}`).join(", ")
    title = `${data.counterName} · ${numbers.length} orders ${data.what}`
    body = numbers.length > 4 ? `${shown} and ${numbers.length - 4} more` : shown
  }

  await self.registration.showNotification(title, {
    body,
    icon: "/icon.svg",
    tag: ALERT_TAG,
    renotify: true,
    requireInteraction: true,
    vibrate: [200, 100, 200],
    data: { url: data.url, numbers, at: Date.now() },
  })
}

self.addEventListener("push", (e) => {
  if (!e.data) return
  const data = e.data.json()
  if (data.counterName) {
    e.waitUntil(showCounterAlert(data))
    return
  }
  e.waitUntil(
    self.registration.showNotification(data.title ?? "VibeQueue", {
      body: data.body,
      icon: data.icon ?? "/icon.svg",
    })
  )
})

self.addEventListener("notificationclick", (e) => {
  e.notification.close()
  const url = e.notification.data?.url ?? "/dashboard"
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((open) => {
      // Counter alerts point back at the terminal that is already open — refocus
      // it rather than stacking a second copy of the console.
      const existing = open.find((c) => new URL(c.url).pathname === url)
      return existing ? existing.focus() : clients.openWindow(url)
    })
  )
})
