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

// A notification still on screen from long ago is not part of "now".
const MERGE_WINDOW_MS = 10 * 60 * 1000

// Ask a visible page whether its operator is actually looking (the page owns
// that idle/visibility logic). `tag` says which kind of alert this is, so a
// manager tab can't vouch for a counter alert. No answer in time counts as "no".
function askAttentive(client, tag) {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => resolve(false), 800)
    channel.port1.onmessage = (ev) => {
      clearTimeout(timer)
      resolve(ev.data === true)
    }
    client.postMessage({ type: "counter-push-check", tag }, [channel.port2])
  })
}

// Payload shape: lib/push/payload.ts. Older payloads ({counterName, number})
// are still understood so a deploy mid-flight doesn't drop an alert.
async function showAlert(data) {
  const tag = data.tag ?? "counter-alert"
  const heading = data.heading ?? data.counterName
  const label = data.label ?? `#${data.number}`
  const noun = data.noun ?? "order"

  const windows = await clients.matchAll({ type: "window", includeUncontrolled: true })
  const visible = windows.filter((c) => c.visibilityState === "visible")
  // Only skipping when a page is on screen is permitted by the Push API, and
  // only worth it when its operator is already looking at the new item.
  if (visible.length && (await Promise.all(visible.map((c) => askAttentive(c, tag)))).some(Boolean)) return

  // Bursts (e.g. a kitchen going offline releases many orders) collapse into
  // one notification instead of a stack. Wording mirrors describeAlertItems()
  // in lib/counterNotifications.ts.
  const existing = await self.registration.getNotifications({ tag })
  const fresh = existing.find((n) => n.data && Date.now() - n.data.at < MERGE_WINDOW_MS)
  const labels = [...new Set([...(fresh?.data.labels ?? []), label])]

  const Noun = noun.charAt(0).toUpperCase() + noun.slice(1)
  let title, body
  if (labels.length === 1) {
    title = `${heading} · ${Noun} ${labels[0]}`
    body = `${Noun} ${labels[0]} is ${data.what}`
  } else {
    const shown = labels.slice(0, 4).join(", ")
    title = `${heading} · ${labels.length} ${noun}s ${data.what}`
    body = labels.length > 4 ? `${shown} and ${labels.length - 4} more` : shown
  }

  await self.registration.showNotification(title, {
    body,
    icon: "/icon.svg",
    tag,
    renotify: true,
    requireInteraction: true,
    vibrate: [200, 100, 200],
    data: { url: data.url, labels, at: Date.now() },
  })
}

self.addEventListener("push", (e) => {
  if (!e.data) return
  const data = e.data.json()
  if (data.heading || data.counterName) {
    e.waitUntil(showAlert(data))
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
