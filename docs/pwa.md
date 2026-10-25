# Progressive Web App (PWA)

VibeQueue ships as an installable PWA — no app store required. When the browser detects the site meets installability criteria, an **Install** prompt appears automatically so users can add the app to their home screen or desktop.

---

## How it works end-to-end

```
Browser fires beforeinstallprompt
        │
        ▼
usePWAInstall.ts   ← captures & stores the event (module singleton)
        │
        ├──▶ InstallPrompt.tsx   (floating banner, global — all pages)
        │
        └──▶ TopBar.tsx          (Install App button — admin panel only)
```

1. The browser fires `beforeinstallprompt` when the installability checklist passes (manifest present, SW registered, HTTPS, not already installed).
2. `usePWAInstall` intercepts and defers the event so the native browser prompt doesn't appear immediately.
3. Any component using the hook gets a `canInstall: true` flag and an `install()` function.
4. Calling `install()` triggers the deferred prompt, waits for the user's choice, and clears the prompt if accepted.

---

## Files

| File | Role |
|---|---|
| [app/manifest.ts](../app/manifest.ts) | Next.js manifest route — serves `/manifest.webmanifest` |
| [public/sw.js](../public/sw.js) | Service worker — caching + push notifications |
| [components/shared/PWARegister.tsx](../components/shared/PWARegister.tsx) | Registers the SW on first render (runs in root layout) |
| [hooks/usePWAInstall.ts](../hooks/usePWAInstall.ts) | Captures `beforeinstallprompt`, exposes `canInstall` + `install()` |
| [components/display/InstallPrompt.tsx](../components/display/InstallPrompt.tsx) | Floating install banner shown on every page |
| [components/admin/TopBar.tsx](../components/admin/TopBar.tsx) | Install App button in the admin top bar |

---

## Web App Manifest

Served automatically by Next.js at `/manifest.webmanifest` via `app/manifest.ts`.

```ts
{
  name: "VibeQueue",
  short_name: "VibeQueue",
  description: "Queue management platform for businesses",
  start_url: "/",
  display: "standalone",       // hides browser chrome when installed
  background_color: "#030712",
  theme_color: "#6366F1",      // indigo — matches brand
  icons: [
    { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }
  ]
}
```

`display: "standalone"` is what makes the browser consider the site installable (required field alongside a registered service worker).

---

## Service Worker (`public/sw.js`)

Registered by `PWARegister` with `updateViaCache: "none"` so stale SW files are never served from the HTTP cache.

### Cache strategy

| Request type | Strategy |
|---|---|
| `/_next/*` internals | **Bypass** — never cached |
| `/api/*` routes | **Bypass** — never cached |
| Navigation (`mode: navigate`) | **Network-only** — always fetches fresh HTML to avoid stale-chunk loops after deploys |
| Everything else (assets, pages) | **Stale-while-revalidate** — serves cached copy instantly, revalidates in background |

### Events handled

| Event | Behaviour |
|---|---|
| `install` | Pre-caches `/`, `/display`, `/dashboard`, `/icon.svg` then calls `skipWaiting()` |
| `activate` | Deletes old cache versions, calls `clients.claim()` |
| `fetch` | Stale-while-revalidate (see above) |
| `push` | Shows a system notification (`data.title`, `data.body`, `data.icon`) |
| `notificationclick` | Refocuses the open window at `notification.data.url` (or opens it); defaults to `/dashboard`. Counter alerts set `data.url` to the counter's own page. |

## Push notifications (counters + managers)

Three kinds of recipient, one pipeline:

| Recipient | Paged when | Opted in from |
|---|---|---|
| Hotel counter (Kitchen / Billing / Delivery) | an order becomes work for that station | **Alerts** switch in the counter header |
| School calling station | a token starts waiting for one of its departments (new, transferred in, or returned from hold; only open counters, and only the pinned desk for a pinned token) | **Alerts** switch in the counter header |
| Manager (hotel admin, branch user, school) | the same events, for branches they can see (admins: all; branch users: their own) | bell in the top bar |

```
queue_entries / school_tokens ──▶ trigger ──▶ pg_net POST {entry_id | school_token_id}
        ──▶ /api/push/notify (x-push-secret) ──▶ after(): wait 1.5s, re-read the row
        ──▶ pick recipients ──▶ web-push ──▶ browser push service
        ──▶ public/sw.js `push`: skipped if a visible page's operator is attentive, else shown
```

Alerts are **off until someone turns them on** (a browser only shows its permission prompt in response to a tap) and the choice is remembered per device. Turning them off unsubscribes the browser. While the page is open and the operator is away, the page also chimes, vibrates and flashes the tab title; if a push doesn't show up within 4 seconds the page shows the notification itself.

| Piece | File |
|---|---|
| Who gets paged — hotel (shared with in-page alerts) | [lib/counterNotifications.ts](../lib/counterNotifications.ts) |
| Tables + triggers | [20261026_counter_push_notifications.sql](../supabase/migrations/20261026_counter_push_notifications.sql), [20261027_school_and_manager_push.sql](../supabase/migrations/20261027_school_and_manager_push.sql) |
| Webhook receiver | [app/api/push/notify/route.ts](../app/api/push/notify/route.ts) |
| Senders | [sendCounterPush.ts](../lib/push/sendCounterPush.ts) (hotel), [sendSchoolPush.ts](../lib/push/sendSchoolPush.ts), [deliver.ts](../lib/push/deliver.ts) (shared; prunes 404/410) |
| Payload shape the worker renders | [lib/push/payload.ts](../lib/push/payload.ts) |
| Subscribe / save / remove | [lib/push/client.ts](../lib/push/client.ts), [lib/actions/push.ts](../lib/actions/push.ts) |
| Toggle state, attention tracking, alert engine | [useAlertPreference](../lib/hooks/useAlertPreference.ts), [useAttention](../lib/hooks/useAttention.ts), [useAlerts](../lib/hooks/useAlerts.ts) |
| UI | [AlertToggle](../components/counter/AlertToggle.tsx) (counter header), [ManagerAlertBell](../components/shared/ManagerAlertBell.tsx) (top bars) |

Not covered: hospital consoles and the hospital manager bar (no hospital trigger yet).

### Setup (once per deployment + database)

1. Env vars on the Vercel project: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:` address), `PUSH_WEBHOOK_SECRET`. Generate keys with `npx web-push generate-vapid-keys`. Keep the same pair for a deployment's lifetime — rotating it invalidates every saved subscription.
2. Run the migrations on that deployment's database: `20261026_…` first, then `20261027_…` (needs the school tables).
3. Point the database at the deployment (one row pair serves hotel *and* school):
   ```sql
   insert into push_config (key, value) values
     ('notify_url',     'https://<deployment>/api/push/notify'),
     ('webhook_secret', '<PUSH_WEBHOOK_SECRET>')
   on conflict (key) do update set value = excluded.value;
   ```
   Delete those two rows to switch all pushes off.
4. On each tablet/PC, open the counter page and flip **Alerts** on once. Managers click the bell.

Debugging: `select status_code, content, created from net._http_response order by created desc limit 5;` shows whether the database reached the route; the route logs a `[push] skipped: …` line saying why nothing was sent.

Platform notes: Chrome on Windows/Android/macOS and Firefox work in a normal tab or installed PWA; iPhone/iPad need the site added to the Home Screen (iOS 16.4+). On Android, set the browser's battery use to Unrestricted or pushes can be delayed. Windows Focus Assist / Linux Do Not Disturb hide banners.
