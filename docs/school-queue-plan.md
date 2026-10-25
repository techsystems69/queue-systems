> **Recovered from the Claude session transcript of 2026-08-25** (session
> `14680e53-b80b-4a63-ae03-b0a7cd59aad7`). This plan was approved and built in that
> session; it was never written to a file at the time. See the status note at the
> bottom for what actually shipped.

# School Queue Management System

## Context

This repo (VibeQueue) is a multi-tenant queue platform whose queue domain is shaped
around a restaurant/retail flow: one running number per branch, a required
`bill_number` on every entry, a kitchen prep stage, and five counter archetypes
(`order | billing | kitchen | delivery | call`).

We need to sell a **school queue system** (per the TECHBIZ Qatar brochure): a
self-service kiosk that dispenses department-prefixed tickets (`A102` Admissions,
`F203` Fees, `C301` Certificates…), a ceiling-mount TV board showing
TOKEN NO. / COUNTER / STATUS, hardware **and** software calling keypads, and a
manager dashboard with department-wise analytics.

Three things in the current model make this impossible to express as a config change:

- `claim_queue_number(p_branch_id)` (`supabase/schema.sql:279`) is a single
  branch-wide integer — no prefix, no per-service series, no daily reset.
- `queue_entries` has `UNIQUE(branch_id, queue_number)`, no department column and
  no `counter_id` — a token can't say *which* window to go to.
- `queue_state.current_serving_number` is **one shared serving slot per branch**, so
  two counters calling at once overwrite each other. A school has N windows serving
  simultaneously.

**Decisions taken:** build the school system in its own `/school` route namespace with
its own tables, so the existing restaurant flow carries zero risk. A customer account is
**either** a business or a school (`customers.vertical`), set at onboarding. The kiosk is
one-tap — department only, no visitor data entry. A counter serves **one or more**
departments via a junction table with a preference order.

**Outcome:** a `/school/*` product — kiosk, TV board, operator keypad, manager
dashboard — running on the same deployment, login and tenancy as today.

---

## Architecture

### Namespace

```
app/(school)/school/
  (manage)/                      ← session-protected, own sidebar layout
    dashboard/  tokens/  reports/  departments/  counters/  screens/  settings/
  (device)/                      ← token-authed, bare full-screen layout
    kiosk/[branchToken]/         ← self-service dispenser
    display/[screenToken]/       ← TV waiting-area board
    counter/[counterToken]/      ← operator calling keypad
```

Route groups resolving to distinct paths under one segment is supported
(`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route-groups.md`).

`proxy.ts` gains `/school` to its protected list, **excluding** `/school/kiosk`,
`/school/display`, `/school/counter` — those authenticate by URL token, exactly like
today's `/counter/[token]` and `/display/[token]`.

`customers.vertical text not null default 'business' check (vertical in ('business','school'))`
selects which product a login sees: `app/(admin)/layout.tsx` and
`components/admin/Sidebar.tsx` route school customers into `/school/*`, and
`lib/actions/auth.ts:34` (`loginAction`) redirects accordingly.

### Reused as-is — do not duplicate

| Concern | Reuse |
|---|---|
| Tenancy & auth | `lib/dal/session.ts` (`requireProfile` / `requireAdmin` / `requireBranchManager`), `lib/dal/users.ts` |
| DB access rule | `createSupabaseServiceClient()` everywhere + app-level guards — RLS here is self-referentially broken (`userGuide/DEV_NOTES.md`); new tables get the service-role-only policy from `supabase/migrations/20260630_create_counters_table.sql` |
| TV registration | the existing `screens` table + `screen_token` — gives the ads cascade, the `max_screens_per_branch` quota (`lib/actions/branches.ts:263-279`) and `last_seen_at` presence for free |
| Media & announcements | `ads`, `screen_ads`, `ticker_messages` + `components/admin/AdsManager.tsx` — this *is* the brochure's "videos, images & announcements" |
| Display parts | `components/display/AdPanel.tsx`, `AdTicker.tsx`, `DisplayClock.tsx`, `displayThemes.ts`, `lib/hooks/useFitScale.ts` |
| Printing | `lib/silentPrint.ts` (QZ Tray 80 mm) + a school-local RawBT wrapper (see caveat below) |
| Console UI kit | `components/counter/console.tsx` — `ConsoleFrame`, `TaskSplit`, `KeypadKey` (:167), `ElapsedPill`, `useTapGuard`, `ConfirmCancel`, `useNow` |
| Keypad reference | `components/counter/CallCounter.tsx:138-158` — 3×4 grid + tall CTA, `inputMode="none"` |
| Admin CRUD pattern | `components/admin/CountersManager.tsx` — `useActionState` + dialog + token copy/regenerate/soft-delete |
| Charts | `components/admin/AnalyticsView.tsx` — recharts `BarChart`/`PieChart` + KPI tiles already match the brochure dashboard; `recharts@3.8.0` is already a dependency |
| Arabic type | already global (`IBM_Plex_Sans_Arabic`, `app/layout.tsx:23-27`, in the `--font-sans` stack) |
| Design rules | `design-system-v5.md` §4 time buckets, §5.3 FIFO emphasis, §5.4 keypad, §5.5 guest display surface, §6 RTL/bilingual, §9 checklist |

---

## Schema

**All school DDL goes in `supabase/migrations/2026XXXX_school_queue.sql` only — do NOT
add it to `supabase/schema.sql`.** That file opens with a `drop table … cascade` block
(`schema.sql:10-24`) despite its "safe to re-run" header; adding school tables there
either gets them silently orphaned by `drop table public.branches cascade`, or nukes
school data when added to the drop list. This is almost certainly why `counters` was
never backported. Keep a separate `supabase/school-schema.sql` if a fresh-install file
is wanted.

Tables (all carry `customer_id`, service-role-only RLS):

- **`school_departments`** — `branch_id, name_en, name_ar, prefix` (1–3 chars),
  `number_start` (default 101), `color`, `icon`, `is_priority`, `display_order`,
  `is_active`. Seeded with the brochure's eight departments via an admin action.
  **`unique (branch_id, prefix) where is_active`** — two active departments sharing a
  prefix would collide on `token_code` and start throwing at the kiosk mid-day.
- **`school_counters`** — `name_en, name_ar, counter_token` (unique uuid text),
  `keypad_code` (**unique per branch**, not globally), `keypad_map jsonb`,
  `accepts_priority`, `display_order`, `is_active`, `is_open`, `last_seen_at`.
- **`school_counter_departments`** — junction with `preference int`. Staff expect their
  primary department first, not strict global-oldest across all assigned departments.
- **`school_tokens`** — `department_id, counter_id (null), service_date, number,
  token_code ('A102'), status ('waiting'|'called'|'held'|'served'|'no-show'|'cancelled'),
  is_priority, source, transferred_from_department_id, notes, joined_at, called_at,
  served_at, call_count, recall_count`.
  `UNIQUE(branch_id, service_date, token_code)`;
  **`unique index on school_tokens(counter_id) where status='called'`** — one active
  token per counter, enforced by the DB rather than a mutable pointer.
  Indexes: `(branch_id, service_date, status)`, `(department_id, service_date, status)`.
- **`school_department_days`** — `(department_id, service_date)` unique + `next_number`.
  The per-department daily cursor: a new date row starts at `number_start`, so the
  **daily reset is free** — no cron, no `alter sequence`, no reset button.
- **`school_settings`** — one row per branch: `school_name_en/ar`, `logo_url`,
  `languages text[]`, `ticket_footer_en/ar`, `kiosk_idle_seconds`, `priority_enabled`,
  `announce_enabled`, `announce_template_en/ar`, `print_enabled`,
  `timezone` (default `Asia/Qatar`), `day_start_time` (default `00:00`).
- **`school_activity_logs`** — the audit trail. `activity_logs` cannot be reused: it has
  a `type` CHECK and an FK `entry_id → queue_entries`. Without this there is no
  recall/no-show/transfer trail behind "performance reports".
- **`screens.kind text not null default 'queue' check (kind in ('queue','school'))`** —
  a one-line addition so a token is valid at exactly one board route. School boards
  ignore `layout` / `numbers_to_show` / `show_estimated_wait` rather than widening those
  restaurant-only CHECK constraints.

**Realtime is opt-in per table.** `schema.sql:680-682` publishes only `queue_state`,
`queue_entries`, `activity_logs` — `counters` was never added, which is why presence is
polled. The migration must include
`alter publication supabase_realtime add table public.school_tokens, public.school_counters;`
or postgres_changes silently never fires. Also: with `REPLICA IDENTITY DEFAULT` a
*filtered* DELETE carries only the PK, so `branch_id=eq.X` drops it — **never hard-delete
tokens**, soft-delete via `status='cancelled'`.

**Serving state is per counter, not per branch** — derived from
`school_tokens.counter_id + status='called'`. No `current_token_id` pointer (it would be
a circular FK and a second source of truth that diverges on a crashed action), and
`queue_state` is untouched.

**Timezone.** "Today" is UTC on both sides today — `new Date().toISOString().split('T')[0]`
(`lib/dal/queue.ts:56,85,224`, `lib/dal/branches.ts:83`) and bare `current_date` on a UTC
Supabase server. For Qatar (UTC+3) the 07:00–16:00 school day happens to survive, but a
manager loading the dashboard before 03:00 local sees the previous day, and an evening
PTM rolls the "day" mid-session. So: `service_date` is computed **only in SQL**, never in
JS and never from the client, as `((now() at time zone v_tz) - v_day_start)::date`, and
every board/dashboard/report query derives its boundary through that same helper. An RPC
and a dashboard that disagree by one day is the most likely support ticket this product
will generate.

### RPCs (SECURITY DEFINER, convention per `claim_queue_number`)

- **`claim_school_token(branch_id, department_id, source, is_priority)`** — the cursor
  bump must be a single `insert … on conflict (department_id, service_date) do update
  set next_number = school_department_days.next_number + 1 returning next_number - 1`.
  Single-row `ON CONFLICT DO UPDATE` holds the row lock to commit, so concurrent kiosks
  serialize correctly with no advisory lock. Never select-then-update (TOCTOU), never
  split into two statements — one plpgsql function is one transaction, so a failed token
  insert rolls the increment back and the series stays gapless.
- **`call_next_school_token(counter_id)`** — picks across the counter's departments
  ordered by `cd.preference, is_priority desc, joined_at asc limit 1
  **for update skip locked**`. Without `SKIP LOCKED`, two counters on the same department
  block and then both act on a row they each saw as `waiting`. Marks it `called`, stamps
  `counter_id`/`called_at`, closes out whatever that counter was serving (→ `served`).
  Strict priority-first starves the normal lane on a busy fees day — cap it (priority
  first unless the oldest normal token has waited > N minutes).
- **`get_school_board(screen_token)`** — **one row per open counter**, ordered by
  `display_order`, LEFT JOINed to its current `called` token (or "—"). A "last N called
  tokens" list would make a counter vanish from the board three calls later; the
  brochure's TOKEN NO. / COUNTER / STATUS layout is per-window and always visible. Plus a
  recently-served strip, per-department waiting counts, branding, and the ads/ticker
  cascade copied from `get_screen_data` (`schema.sql:424-467`). Stamps `last_seen_at`.

`lib/db/types.ts` has no codegen — each table needs a `Db*`, a `*DTO` and a `to*DTO`,
plus a `SchoolBoardPacket` mirroring `ScreenDataPacket` (`lib/db/types.ts:433`).

---

## Surfaces

Kiosk and counter pages export the zoom-locked `viewport` from
`app/(public)/counter/[token]/page.tsx:15-21` — fast repeated taps on a touch terminal
must never trigger pinch/double-tap zoom.

**Kiosk** `/school/kiosk/[branchToken]` — authenticates on `branches.branch_token` (the
substrate exists; `kioskAddEntryAction` at `lib/actions/queue.ts:218` is dead code we
replace, not extend). Bilingual department grid, colour + icon + large targets, priority
toggle, EN/AR switch. One tap issues the token. **The token row commits server-side
before printing is attempted**, and the big token code stays on screen for
`kiosk_idle_seconds` regardless — if RawBT/QZ throws, the visitor still has their number.
Ticket markup adapted from `OrderCounter.tsx:144-165` (80 mm × 80 mm, number 60 pt/900).

> **Print caveat that will bite on day one:** `lib/rawbtPrint.ts:39` calls
> `html2canvas(el, { scale, backgroundColor })` with no `useCORS: true`. `OrderCounter`
> gets away with it because `/tech-logo.png` is same-origin; a school logo served from
> Supabase Storage is cross-origin, so the canvas taints and the ticket prints with a
> blank logo. Use a school-local print helper with `useCORS: true` and verify the storage
> bucket sends CORS headers.

**TV board** `/school/display/[screenToken]` — a new component on the §5.5 dark token
set, not a fork of `TVDisplay.tsx` (which is welded to `useSupabaseQueue(branchId)`
reading tables school has no rows in). Header (logo, school name, clock + date), the
per-counter TOKEN NO. | COUNTER | STATUS table, a one-shot flash + TTS overlay, plus the
reused ads panel and ticker.

- Copy the three-tier announcer (`window.AndroidTTS` → Web Speech → WebAudio chime,
  `TVDisplay.tsx:87-103`) into `lib/school/announce.ts` rather than extracting it —
  extraction would touch the file we promised zero risk to. **Fix the subscription bug in
  the copy**: `TVDisplay.tsx:175-203` has dep array `[announce]` while the channel closes
  over `branchId`, so it never resubscribes.
- Token codes are strings, so the utterance spells the prefix letter then the digits and
  names the counter — two variables, in two languages. Templates live in
  `school_settings.announce_template_en/ar`, not hardcoded; Arabic needs a transliterated
  prefix rather than a raw Latin letter.
- **Add a 45–60 s safety refetch and a `CHANNEL_ERROR`/`CLOSED`/`TIMED_OUT` resubscribe
  handler.** There is no polling anywhere in the codebase today, so a ceiling-mounted TV
  that drops its WebSocket goes stale forever with nobody there to reload it — and
  `last_seen_at` (stamped only inside the board RPC) freezes too, so presence lies.

**Operator keypad** `/school/counter/[counterToken]` — `KeypadKey` 3×4 grid + tall
**CALL**, plus **NEXT**, **RECALL**, **HOLD**, **NO SHOW** (two-tap `ConfirmCancel`) and
**DONE**; a current-token hero and the waiting lane for this counter's departments with
§5.3 FIFO emphasis (see `KitchenCounter.tsx:100-160` for the reference implementation).
Every mutation re-verifies the counter token server-side, mirroring `verifyCounterToken`
(`lib/actions/counters.ts:11-20`). Also supports **transfer to another department** —
Reception → Fees is the most common school flow.

**Hardware keypad** — USB-HID is the shipping default: these keypads enumerate as
keyboards, so the operator page binds a global `keydown`. Two traps: the display field is
`inputMode="none"` but still focusable, so ignore events whose target is an input; and
cheap keypads emit `Enter` for both digit-commit and a dedicated key, so buffer
scanner-style with an inter-key timeout. Key mapping lives in
`school_counters.keypad_map`, not hardcoded.

> **Confirm the hardware model before building the LAN path.** Most inexpensive "LAN
> calling keypads" speak raw TCP/UDP or Modbus, not HTTP — a Vercel-hosted route handler
> cannot receive that without an on-prem bridge. (The `ZY307` PDF in the repo root is the
> 80 mm ESC/POS *printer*, not the keypad.) If HTTP is confirmed,
> `POST /api/school/keypad` would be the app's **first** route handler — `proxy.ts`'s
> matcher excludes `api`, so it must do its own token verification, rate limiting, and
> carry a `nonce`/`seq` so a retried packet doesn't advance the queue twice.

**Manager** — `/school/dashboard` (Total Tokens / Served / Waiting / Avg Wait tiles, live
department board), `/school/reports` (recharts bar "Token Summary" + pie "Department
Wise", daily/weekly/monthly), `/school/tokens` (history + CSV export),
`/school/departments`, `/school/counters`, `/school/screens`, `/school/settings`,
`/school/users`.

Avg wait = `called_at − joined_at`. Do **not** replicate `lib/dal/queue.ts:246`, which
computes `completed_at − started_at` (service duration) and labels it wait time.

**Realtime** — postgres_changes on `school_tokens` + `school_counters` filtered
`branch_id=eq.X`, following `lib/hooks/useRealtimeQueue.ts` (including its `useId()` +
mount-counter channel naming), plus broadcast topic `school-display-${branchId}` with
`token-called` / `token-recalled` for the TTS re-announce — a recall changes no visible
column (`lib/actions/counters.ts:64-83`).

---

## Build order

**Phase 1 — the operating loop**

1. `supabase/migrations/2026XXXX_school_queue.sql` — 7 tables, indexes, partial unique
   indexes, service-role RLS policy, `alter publication supabase_realtime`,
   `screens.kind`, `customers.vertical`, and the three RPCs.
2. `lib/db/types.ts` — `Db*` / `*DTO` / `to*DTO` per table + `SchoolBoardPacket`.
3. `lib/dal/school/{departments,counters,tokens,settings}.ts` — `cache()` +
   `createSupabaseServiceClient()`, mirroring `lib/dal/counters.ts`.
4. `lib/actions/school/{departments,counters,tokens}.ts` + `broadcast.ts` (copy
   `broadcastDisplaySignal`, retyped for string token codes).
5. `proxy.ts` — `/school` gated except the three device paths; `customers.vertical`
   routing in `app/(admin)/layout.tsx`, `components/admin/Sidebar.tsx`,
   `lib/actions/auth.ts`.
6. `app/(school)/school/(manage)/{layout,departments,counters,settings,screens}` +
   a "load the 8 default departments" seed action. **Settings and screens are Phase 1,
   not Phase 2** — the kiosk ticket and board need school name/logo/languages/timezone,
   and without the screens page there's no token to test the board with.
7. `lib/hooks/useSchoolBoard.ts` (safety poll + resubscribe) and `useSchoolQueue.ts`.
8. `components/school/SchoolKiosk.tsx` + ticket + `school/(device)/kiosk/[branchToken]`.
9. `components/school/SchoolBoard.tsx` + `lib/school/announce.ts` +
   `school/(device)/display/[screenToken]`.
10. `components/school/SchoolCounterConsole.tsx` + `school/(device)/counter/[counterToken]`.

**Phase 2 — management & analytics**

11. `/school/dashboard`, `/school/reports`, `/school/tokens` (+ CSV export).
12. `/school/users`, per-department rolling average wait on the ticket and board.
13. Hardware keypad LAN endpoint, *if* the hardware is confirmed to speak HTTP.
14. Android shell: `android-kiosk/.../MainActivity.kt:22` hardcodes
    `DISPLAY_URL = ".../display"` with no token and now redirects. Cheapest fix, decided
    in Phase 1: have `/display/[token]` server-redirect to `/school/display/[token]` when
    `screens.kind='school'` — zero APK rebuild.

---

## Open items to flag, not silently drop

- **Counter access control.** A counter is authenticated by a shared URL token, so anyone
  with the link can call tokens at the Fees window. Roles are only `admin | branch_user`.
  Either accept this (as the existing product does) or add `school_counter_users`.
- **`plans.max_daily_entries` is unenforced** in the current code; eight departments will
  blow past a Starter tier's 200/day.
- **Offline tolerance is zero** — server-action issuance means a LAN outage stops
  ticketing entirely.
- **Multi-campus roll-up.** "Real-time monitoring of all departments" for a multi-branch
  school implies a customer-wide view; this design is branch-scoped.

---

## Verification

- **Migration**: apply, then re-run — must be idempotent like the existing ones. Confirm
  `supabase_realtime` lists `school_tokens` and `school_counters`.
- **Numbering**: issue from two departments concurrently — `A101, A102…` / `F101, F102…`
  independent, gapless, collision-free. Roll `service_date` to confirm the daily reset,
  and confirm it fires at local midnight (or `day_start_time`), not 03:00.
- **Concurrency**: two counter tabs pressing NEXT on the same department simultaneously
  must never receive the same token; the partial unique index must reject any second
  `called` token on one counter.
- **End-to-end** (`npm run dev`, browser automation across four tabs): kiosk issues
  `A101` → board lists Counter 1 with "—" → counter presses NEXT → board flips to
  `A101 | Counter 1 | Please Proceed`, flashes and announces → DONE clears it back to "—".
- **Board resilience**: kill the network on the display tab, restore it, and confirm the
  board recovers without a manual reload.
- **Print**: with `silent_print` off, confirm the ticket renders 80 mm square with the
  token code at 60 pt **and a Supabase-hosted logo actually appears** (the `useCORS` fix).
  RawBT and QZ paths need real hardware; verify generated markup only.
- **Isolation**: exercise `/counter/[token]`, `/display/[token]` and `/dashboard` on a
  `vertical='business'` customer and confirm nothing changed.
- **Design system**: run the §9 checklist on each new route in both orientations and both
  `dir` values.
- `npm run lint` and `npm run build` clean.


---

# Status as built (verified 2026-08-26)

The 2026-08-25 session **ran to completion** — it was not cut off. Everything below is
on disk and uncommitted.

## Shipped

| Layer | Files |
|---|---|
| Migration | `supabase/migrations/20260825_school_queue_system.sql` — 7 tables, 4 RPCs (`school_service_date`, `claim_school_token`, `call_next_school_token`, `get_school_board`), service-role RLS, `customers.vertical`, `screens.kind` |
| Types | `lib/db/school-types.ts` |
| DAL | `lib/dal/school.ts`, `lib/dal/school-context.ts` |
| Actions | `lib/actions/school-admin.ts`, `school-tokens.ts`, `school-read.ts` |
| Hooks | `lib/hooks/useSchoolBoard.ts` |
| Lib | `lib/school/{announce,constants,exportCsv,printTicket}.ts` |
| Routes | `app/(school)/school/(device)/{kiosk,display,counter}` + `(manage)/{dashboard,departments,counters,screens,tokens,reports,users,settings}` |
| Components | 12 files in `components/school/` |
| Wiring | `proxy.ts` (school gated, 3 device paths open), `app/(admin)/layout.tsx`, `lib/actions/auth.ts`, `app/(public)/display/[token]/page.tsx` (redirects school screens) |

## Deviations from the plan above

1. **No `postgres_changes` on school tables.** Browser uses the anon key; subscribing
   would need an anon SELECT policy, which would expose `school_counters.counter_token`
   — the credential that authorises calling. Live updates go over a Realtime *broadcast*
   topic instead, with a short poll as state of record (which doubles as the recovery
   path the plan wanted). The migration deliberately does **not** `alter publication`.
2. Types live in `lib/db/school-types.ts`, not appended to `lib/db/types.ts`.
3. DAL/actions are flat files (`lib/dal/school.ts`) rather than the `lib/dal/school/`
   directory the plan sketched.
4. `components/admin/Sidebar.tsx` was **not** changed — school tenants get their own
   `SchoolSidebar`, so routing at the layout level was enough.

## Remaining

- [ ] **Apply the migration** in the Supabase SQL editor (never ran — the build sandbox
      had no DNS to `*.supabase.co`).
- [ ] **Set `vertical = 'school'`** on the tenant; that alone routes their login.
- [ ] **End-to-end run** — kiosk → board → keypad → done, four tabs. Never executed.
- [ ] Seed via Departments → "Load the 8 standard departments", add counters, assign
      departments, open links from the Devices page.
- [ ] LAN/WiFi keypad endpoint — deferred pending the hardware model. USB-HID works
      today (digits, Enter = Call/Next, `+` Next, `−` No-show, `*` Recall).
- [ ] Estimated wait on ticket and board — board shows live waiting counts, not a
      predicted time.
- [ ] **Commit the work.** 35 uncommitted paths as of 2026-08-26.

## Watch out when committing

Several pre-existing files were rewritten CRLF → LF, inflating the diff:

- `components/admin/Sidebar.tsx` — 147+/147- raw, **0 real changes**
- `proxy.ts` — 69+/59- raw, **11+/1- real**

Use `git diff --ignore-cr-at-eol` to see the true diff.

---

# Addendum 2026-10-25 — per-department / per-counter kiosks and displays

Migration `supabase/migrations/20261025_school_scoped_devices.sql` (requires
`20260904_school_content_locale_jsonb` and `20260906_school_token_locale`).

- **Displays** (`screens`, kind `school`) take an optional scope: `school_screen_departments`
  and `school_screen_counters`. A scoped board lists only the counters in scope (named
  counters + counters serving a named department), counts only those departments' queues,
  and ignores broadcast calls for other counters (`SchoolCallSignal.counterId`). No scope
  rows = whole school, exactly as before.
- **Kiosks**: the branch-token kiosk is unchanged. `school_kiosks` adds individually
  addressed kiosks with their own `kiosk_token`, either scoped to some departments
  (`school_kiosk_departments`) or **dedicated to one counter** (`counter_id`). A desk
  kiosk offers that counter's departments and pins each ticket via
  `school_tokens.target_counter_id`; `call_next_school_token` skips tokens pinned to
  another counter. `/api/kiosk/[token]/*` and `/school/kiosk/[token]` resolve either token
  through `resolveSchoolKiosk()` (lib/dal/school.ts), so the Flutter app needs no change.
- Deactivating a counter returns its pinned waiting tokens to the shared pool; a desk kiosk
  whose counter is inactive reports "inactive" until the counter is reactivated.
- **Departments → Set up desk** creates counter + scoped display + desk kiosk in one go
  (`provisionSchoolDeskAction`); quotas are checked first.
- Not applied to any database yet. Scoped displays count against the plan's
  `max_screens_per_branch`.
